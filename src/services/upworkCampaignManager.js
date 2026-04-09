import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { storage } from './storage.js';
import { upworkJobService } from './upworkJobService.js';
import { processApifyDataWithChatGPT } from './apifyToGPTProcessor.js';
import { parseCodeResponse, generateCodeWithGPT } from './Codegenerator.js';
import { completeWorkflow } from './completeworkflow.js';
import { extractAndRepairJSON, normalizeJobFilterResponse } from '../utils/jsonRepairUtil.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Upwork Campaign Manager
 * Continuously fetches Upwork jobs, filters them with GPT, and creates repos
 */
class UpworkCampaignManager extends EventEmitter {
  constructor() {
    super();
    this.running = new Map();
    this.seenJobIds = new Map(); // Track seen jobs per campaign: campaignId -> Set of job IDs
    this.prompts = {
      filter: '',
      scraperReadme: '',
      automationReadme: ''
    };
    this.loadPrompts();
    console.log('UpworkCampaignManager initialized');
  }

  /**
   * Check if job was posted within the specified number of minutes
   * @param {string|number|Date} createdDateTime - Job posting time
   * @param {number} minutes - Time window in minutes (default: 5)
   * @returns {boolean}
   */
  isJobPostedWithinMinutes(createdDateTime, minutes = 15) {
    if (!createdDateTime || createdDateTime === 'Unknown') {
      return false;
    }

    const now = new Date();
    let jobDate = null;

    try {
      // Handle Date object
      if (createdDateTime instanceof Date) {
        jobDate = createdDateTime;
      }
      // Handle timestamp (milliseconds)
      else if (typeof createdDateTime === 'number') {
        jobDate = new Date(createdDateTime);
      }
      // Handle string
      else if (typeof createdDateTime === 'string') {
        // Try ISO format first
        jobDate = new Date(createdDateTime);
        
        // If invalid, try parsing as timestamp
        if (isNaN(jobDate.getTime())) {
          const timestamp = parseFloat(createdDateTime);
          if (!isNaN(timestamp)) {
            jobDate = new Date(timestamp);
          }
        }
      }

      if (!jobDate || isNaN(jobDate.getTime())) {
        return false;
      }

      // Calculate time difference in minutes
      const diffMs = now - jobDate;
      const diffMinutes = diffMs / (1000 * 60);
      
      return diffMinutes <= minutes;

    } catch (error) {
      console.error('Error parsing job date:', error);
      return false;
    }
  }
  async getAccountProxyInfo(accountId) {
  const account = await storage.getGithubAccountWithProxy(accountId);
  
  return {
    proxyUrl: account.assignedProxy || null,
    sessionId: account.proxySessionId || null
  };
}
  /**
   * Extract topics from metadata block with comprehensive pattern support
   */
  extractTopicsFromMetadata(metadataBlock) {
    console.log('\n🔍 Extracting topics with comprehensive pattern matching...');
    
    const topics = [];
    
    // Pattern 1: Single line with label (comma, semicolon, pipe separated)
    const singleLinePatterns = [
      /(?:Related Topics|Topics|Tags|Keywords):\s*([^\n]+)/i,
      /(?:Related Topics|Topics|Tags|Keywords)\s*[=:]\s*([^\n]+)/i,
    ];
    
    for (const pattern of singleLinePatterns) {
      const match = metadataBlock.match(pattern);
      if (match) {
        console.log(`  ✅ Found single-line topics: ${pattern}`);
        const rawTopics = match[1];
        
        // Try various delimiters: comma, semicolon, pipe, newline
        const delimiters = [',', ';', '|', '\n'];
        let extracted = [];
        
        for (const delimiter of delimiters) {
          if (rawTopics.includes(delimiter)) {
            extracted = rawTopics.split(delimiter).map(t => t.trim()).filter(t => t.length > 0);
            if (extracted.length > 1) break;
          }
        }
        
        // If no delimiter worked, try space-separated (if multiple words)
        if (extracted.length === 0) {
          extracted = [rawTopics.trim()];
        }
        
        topics.push(...extracted);
        if (topics.length > 0) return this.cleanTopicsArray(topics);
      }
    }
    
    // Pattern 2: Multi-line topics (bullet points or numbered)
    const multiLineMatch = metadataBlock.match(
      /(?:Related Topics|Topics|Tags|Keywords):\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i
    );
    
    if (multiLineMatch) {
      console.log('  ✅ Found multi-line topics');
      const lines = multiLineMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (const line of lines) {
        // Remove bullet points, numbers, dashes
        const cleaned = line.replace(/^[-*•\d\.\)]+\s*/, '').trim();
        if (cleaned.length > 0 && !cleaned.match(/^[A-Z][a-z]+\s*:/)) {
          topics.push(cleaned);
        }
      }
      
      if (topics.length > 0) return this.cleanTopicsArray(topics);
    }
    
    // Pattern 3: Array format ["topic1", "topic2"] or ['topic1', 'topic2']
    const arrayMatch = metadataBlock.match(
      /(?:Related Topics|Topics|Tags|Keywords):\s*\[([\s\S]*?)\]/i
    );
    
    if (arrayMatch) {
      console.log('  ✅ Found array-formatted topics');
      const arrayContent = arrayMatch[1];
      const items = arrayContent.match(/["']([^"']+)["']/g);
      
      if (items) {
        topics.push(...items.map(item => item.replace(/["']/g, '').trim()));
        if (topics.length > 0) return this.cleanTopicsArray(topics);
      }
    }
    
    // Pattern 4: Inline within metadata (no explicit label, after description)
    const inlineMatch = metadataBlock.match(
      /Description:[^\n]*\n\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+){2,})/i
    );
    
    if (inlineMatch) {
      console.log('  ✅ Found inline topics after description');
      topics.push(...inlineMatch[1].split(',').map(t => t.trim()));
      if (topics.length > 0) return this.cleanTopicsArray(topics);
    }
    
    // Pattern 5: Anywhere in metadata with common topic keywords
    const anywhereMatch = metadataBlock.match(
      /(?:scraper|automation|api|data|web|tool|bot|monitor|tracker|parser|extractor|crawler|fetcher)(?:\s*,\s*(?:[a-z0-9-]+)){2,}/i
    );
    
    if (anywhereMatch) {
      console.log('  ✅ Found topics by keyword detection');
      topics.push(...anywhereMatch[0].split(',').map(t => t.trim()));
      if (topics.length > 0) return this.cleanTopicsArray(topics);
    }
    
    console.log('  ⚠️  No topics found with any pattern');
    return [];
  }

  cleanTopicsArray(topics) {
    const cleaned = topics
      .map(t => {
        // Remove quotes, brackets, extra spaces
        let clean = t.replace(/["'\[\]()]/g, '').trim();
        
        // Remove leading bullets, numbers, dashes
        clean = clean.replace(/^[-*•\d\.\)]+\s*/, '');
        
        // GitHub topic rules: lowercase, alphanumeric + hyphens only
        // 1. Convert to lowercase first
        clean = clean.toLowerCase();
        
        // 2. Replace all whitespace with hyphens
        clean = clean.replace(/\s+/g, '-');
        
        // 3. Replace all non-alphanumeric chars (except hyphens) with hyphens
        clean = clean.replace(/[^a-z0-9-]/g, '-');
        
        // 4. Collapse multiple consecutive hyphens
        clean = clean.replace(/-+/g, '-');
        
        // 5. Remove leading/trailing hyphens
        clean = clean.replace(/^-+|-+$/g, '');
        
        return clean;
      })
      .filter(t => {
        // GitHub limits: 1-50 chars, not just numbers
        return t.length > 0 && t.length <= 50 && !/^\d+$/.test(t);
      })
      .slice(0, 20); // Max 20 topics per GitHub
    
    // Remove duplicates
    return [...new Set(cleaned)];
  }

  /**
   * Log function - same as before
   */
  /**
   * Load prompts from text files
   */
  loadPrompts() {
    try {
      const promptsDir = path.join(__dirname, '..', '..', 'prompts');
      
      this.prompts.filter = fs.readFileSync(
        path.join(promptsDir, 'upwork-saas-filter.txt'),
        'utf-8'
      );
      
      this.prompts.scraperReadme = fs.readFileSync(
        path.join(promptsDir, 'upwork-scraper-readme.txt'),
        'utf-8'
      );
      
      this.prompts.automationReadme = fs.readFileSync(
        path.join(promptsDir, 'upwork-automation-readme.txt'),
        'utf-8'
      );
      
      console.log('✅ Loaded all prompts successfully');
    } catch (error) {
      console.error('❌ Failed to load prompts:', error);
      throw new Error('Failed to load prompts. Make sure prompt files exist in the prompts folder.');
    }
  }

  log(campaignId, level, message) {
    const evt = { campaignId, level, message, timestamp: Date.now() };
    storage.appendLog(campaignId, evt);
    this.emit('log', evt);
    
    const emoji = {
      info: '[info]',
      success: '[success]',
      error: '[error]',
      warning: '[warning]'
    }[level] || '[log]';

    console.log(`${emoji} [${campaignId}] ${message}`);
  }

  setStatus(campaignId, status) {
    console.log(`Setting Upwork campaign ${campaignId} status to: ${status}`);
    storage.updateUpworkCampaign(campaignId, { status });
    this.emit('status', { campaignId, status });
  }

  updateProgress(campaignId, processed, total, viable = 0, nonViable = 0) {
    const progress = { processed, total, viable, nonViable };
    console.log(`Progress update: ${processed}/${total} (Viable: ${viable}, Non-viable: ${nonViable})`);
    storage.updateUpworkCampaign(campaignId, { progress });
    this.emit('progress', { campaignId, ...progress });
  }

  /**
   * Filter job with GPT using the SaaS viability filter prompt
   * @param {Object} jobDetails - Detailed job information
   * @param {string} cookies - GPT account cookies
   * @returns {Promise<{viable: boolean, niche: string, platform: string, tool: string}>}
   */
  /**
   * Send prompt using clipboard paste method (most reliable)
   */
  async sendPromptToGPT(page, prompt, logFn) {
    logFn(`📤 Preparing to send prompt...`);
    
    try {
      // Method 1: Use clipboard paste (most reliable for long text)
      logFn(`⌨️ Using clipboard paste method...`);
      
      // Copy prompt to clipboard
      await page.evaluate((text) => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }, prompt);
      
      // Find textarea and focus it
      const textareaSelector = 'textarea#prompt-textarea, textarea[placeholder*="Message"], div[contenteditable="true"]';
      await page.waitForSelector(textareaSelector, { timeout: 10000 });
      await page.click(textareaSelector);
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Paste using keyboard shortcut
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyV');
      await page.keyboard.up('Control');
      
      logFn(`✅ Prompt pasted successfully`);
      
      // Wait for the text to appear
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify the text was pasted
      const textContent = await page.evaluate((selector) => {
        const textarea = document.querySelector(selector);
        return textarea ? (textarea.value || textarea.textContent || textarea.innerText) : '';
      }, textareaSelector);
      
      if (textContent.length < prompt.length * 0.9) {
        logFn(`⚠️ Clipboard paste may have failed, trying direct DOM method...`);
        await this.sendPromptDirectDOM(page, prompt, textareaSelector);
      }
      
    } catch (error) {
      logFn(`⚠️ Clipboard method failed: ${error.message}, trying direct DOM method...`);
      const textareaSelector = 'textarea#prompt-textarea, textarea[placeholder*="Message"], div[contenteditable="true"]';
      await this.sendPromptDirectDOM(page, prompt, textareaSelector);
    }
    
    // Wait a moment for the text to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Find and click send button
    logFn(`📤 Sending message...`);
    const sendButtonSelector = 'button[data-testid="send-button"], button[aria-label*="Send"]';
    
    try {
      await page.waitForSelector(sendButtonSelector, { timeout: 5000 });
      await page.click(sendButtonSelector);
    } catch (e) {
      // Fallback: press Enter
      logFn(`⚠️ Send button not found, using Enter key...`);
      await page.keyboard.press('Enter');
    }
    
    logFn(`✅ Message sent`);
  }

  /**
   * Send prompt by directly manipulating the DOM (fallback method)
   */
  async sendPromptDirectDOM(page, prompt, textareaSelector) {
    await page.evaluate((selector, text) => {
      const el = document.querySelector(selector);
      if (!el) return;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.contentEditable === 'true') {
        el.focus();
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        });
        el.dispatchEvent(inputEvent);
      }
    }, textareaSelector, prompt);
  }

  /**
   * Wait for GPT response to complete with robust detection and timeout safeguards
   * Backwards compatible signature: (page, logFn, maxStableChecks?, checkInterval?, minLength?)
   */
  async waitForGPTResponse(page, logFn, a = 5, b = 2000, c = 50) {
    // Support old positional args or new options object
    const opts = typeof a === 'object'
      ? { maxStableChecks: 5, checkInterval: 2000, minLength: 50, overallTimeoutMs: 120000, resendOnIdleMs: 15000, ...a }
      : { maxStableChecks: a, checkInterval: b, minLength: c, overallTimeoutMs: 120000, resendOnIdleMs: 15000 };

    let previousLength = 0;
    let stableCount = 0;
    const start = Date.now();
    let lastChangeTs = Date.now();
    let resentOnce = false;

    logFn(`⏳ Waiting for response to complete...`);

    while (true) {
      // Timeout guard
      const elapsed = Date.now() - start;
      if (elapsed > opts.overallTimeoutMs) {
        logFn(`⏱️ Timeout waiting for response (~${Math.round(opts.overallTimeoutMs/1000)}s). Proceeding with current content.`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, opts.checkInterval));

      const state = await page.evaluate(() => {
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = messages.length > 0 ? messages[messages.length - 1] : null;
        const length = last ? (last.textContent?.length || 0) : 0;
        const isGenerating = !!(document.querySelector('[data-testid="stop-button"], [aria-label*="Stop generating"]'));
        const hasRegenerate = !!document.querySelector('[data-testid="regenerate-button"], button:has(svg[aria-label*="Regenerate"])');
        return { length, isGenerating, hasRegenerate };
      });

      // Consider finished if generation stopped and we have meaningful content
      if (!state.isGenerating && state.length > opts.minLength) {
        // Require a couple stable checks to ensure it's settled
        if (state.length === previousLength) {
          stableCount++;
        } else {
          stableCount = 0;
        }
        previousLength = state.length;

        if (stableCount >= opts.maxStableChecks) {
          logFn(`✅ Response complete (stable at ${state.length} chars)`);
          break;
        }
        continue;
      }

      // Track changes to detect idle
      if (state.length !== previousLength) {
        lastChangeTs = Date.now();
        stableCount = 0;
        previousLength = state.length;
      }

      // If idle for too long and nothing seems to be generating, try a gentle nudge (press Enter once)
      if (!state.isGenerating && state.length <= opts.minLength && (Date.now() - lastChangeTs) > opts.resendOnIdleMs && !resentOnce) {
        try {
          logFn('⚠️ No output detected after sending. Nudging with Enter once...');
          await page.keyboard.press('Enter');
          resentOnce = true;
          lastChangeTs = Date.now();
          continue;
        } catch {}
      }

      // Keep page scrolled to bottom to avoid lazy rendering issues
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } catch {}
    }
  }

  /**
   * Extract response from ChatGPT DOM
   * FIXED: Preserves code fences for metadata extraction
   */
  async extractGPTResponse(page) {
    return await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        
        // Remove copy buttons
        const clone = lastMessage.cloneNode(true);
        clone.querySelectorAll('button, [class*="copy"], [aria-label*="Copy"]').forEach(el => el.remove());
        
        // Reconstruct markdown with code fences
        let fullText = '';
        
        // Find all code blocks and reconstruct with fences
        const codeBlocks = clone.querySelectorAll('pre');
        if (codeBlocks.length > 0) {
          // Walk through DOM to preserve order
          const walker = document.createTreeWalker(
            clone,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            null
          );
          
          let node;
          let lastProcessedPre = null;
          
          while (node = walker.nextNode()) {
            // Skip if already processed as part of a pre block
            if (lastProcessedPre && lastProcessedPre.contains(node)) {
              continue;
            }
            
            if (node.nodeName === 'PRE') {
              lastProcessedPre = node;
              const code = node.querySelector('code');
              if (code) {
                // Get language from class (e.g., "language-pgsql")
                const langClass = code.className.match(/language-(\w+)/);
                const lang = langClass ? langClass[1] : '';
                
                // Reconstruct code fence
                fullText += `\n\`\`\`${lang}\n${code.textContent}\n\`\`\`\n`;
              }
            } else if (node.nodeType === Node.TEXT_NODE) {
              // Add text nodes
              const text = node.textContent.trim();
              if (text) {
                fullText += text + '\n';
              }
            } else if (node.nodeName === 'P' || node.nodeName === 'H1' || node.nodeName === 'H2' || node.nodeName === 'H3') {
              // For paragraphs and headers, get their text if not already processed
              if (!lastProcessedPre || !lastProcessedPre.contains(node)) {
                const text = node.textContent.trim();
                if (text && !fullText.includes(text)) {
                  fullText += text + '\n';
                }
              }
            }
          }
          
          return fullText.replace(/Copy code/gi, '').replace(/\n{3,}/g, '\n\n').trim();
        }
        
        // Fallback to textContent if no code blocks
        return lastMessage.textContent || '';
      }
      return '';
    });
  }

  /**
   * Sanitize cookies for Puppeteer / DevTools Protocol compatibility
   * Same implementation as apifyToGPTProcessor.js
   */
  sanitizeCookies(cookies) {
    if (!Array.isArray(cookies)) return [];
    
    return cookies.map(c => {
      try {
        const out = {
          name: c.name || c.key || '',
          value: c.value || c.session || c.sessionToken || '',
          domain: c.domain,
          path: c.path || '/',
          secure: !!c.secure,
          httpOnly: !!c.httpOnly
        };

        // expirationDate -> expires (DevTools expects number of seconds)
        if (c.expirationDate && !isNaN(Number(c.expirationDate))) {
          out.expires = Math.floor(Number(c.expirationDate));
        }

        // Normalize sameSite values to Strict, Lax, None (case-sensitive per protocol)
        if (c.sameSite) {
          const s = String(c.sameSite).toLowerCase();
          if (s === 'lax') out.sameSite = 'Lax';
          else if (s === 'strict') out.sameSite = 'Strict';
          else if (s === 'none' || s === 'no_restriction' || s === 'no-restrictions' || s === 'no-restriction') out.sameSite = 'None';
          // otherwise omit invalid sameSite
        }

        // Drop empty-name/value cookies
        if (!out.name || out.value === undefined || out.value === null) return null;

        return out;
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }

  async filterJobWithGPT(jobDetails, cookies, campaignId) {
    this.log(campaignId, 'info', `🤖 Filtering job: ${jobDetails.title}`);
    
    const puppeteer = (await import('puppeteer')).default;
    let browser;
    
    try {
      // Build the full prompt
      const jobDescription = upworkJobService.buildJobDescription(jobDetails);
      const fullPrompt = `${this.prompts.filter}\n\n====================================================\n\nJob to analyze:\n\n${jobDescription}`;
      
      this.log(campaignId, 'info', 'Sending job to GPT for viability check...');
      
      // Launch headless browser (same as apifyToGPTProcessor)
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: { width: 1920, height: 1080 }
      });

      const page = await browser.newPage();

      // Set realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Load cookies with sanitization
      if (cookies && Array.isArray(cookies)) {
        const sanitizedCookies = this.sanitizeCookies(cookies);
        if (sanitizedCookies.length > 0) {
          await page.setCookie(...sanitizedCookies);
        }
      }

      // Navigate to ChatGPT
      await page.goto('https://chatgpt.com/', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });

      // Wait for page load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.URL.includes('/auth/login');
      });

      if (!isLoggedIn) {
        throw new Error('Not logged in to ChatGPT. Please update GPT account cookies.');
      }

      // Wait for textarea
      await page.waitForSelector('textarea, div[contenteditable="true"]', { timeout: 30000 });

      // Send prompt using helper method (same as apifyToGPTProcessor)
      await this.sendPromptToGPT(page, fullPrompt, (msg) => this.log(campaignId, 'info', msg));

      // Wait for response to complete
      await this.waitForGPTResponse(page, (msg) => this.log(campaignId, 'info', msg), 5, 2000, 50);

      // Extract response
      const responseText = await this.extractGPTResponse(page);

      if (!responseText) {
        throw new Error('No response received from GPT');
      }

      this.log(campaignId, 'info', `GPT Response (first 200 chars): ${responseText.substring(0, 200)}...`);

      // Parse JSON response with auto-repair
      this.log(campaignId, 'info', '🔧 Parsing and repairing JSON response...');
      
      let result;
      try {
        const parsed = extractAndRepairJSON(
          responseText, 
          `[${campaignId}] `
        );
        
        // Normalize the response structure for new prompt format
        result = normalizeJobFilterResponse(parsed);
        
        this.log(campaignId, 'success', `✅ JSON parsed successfully`);
        this.log(campaignId, 'info', `   Open Source Viable: ${result.open_source_viable}`);
        this.log(campaignId, 'info', `   Niche: ${result.niche}`);
        this.log(campaignId, 'info', `   Platform: ${result.platform}`);
        this.log(campaignId, 'info', `   Platform Domain: ${result['platform domain'] || 'None'}`);
        this.log(campaignId, 'info', `   Tool: ${result.tool}`);
        
      } catch (jsonError) {
        this.log(campaignId, 'error', `JSON parsing failed: ${jsonError.message}`);
        this.log(campaignId, 'warning', 'Treating job as non-viable due to parse error');
        
        // Return safe default
        return { 
          viable: false, 
          niche: 'None',
          platform: 'None',
          platformDomain: 'None',
          tool: 'None'
        };
      }

      // Check if job is viable: needs both platform AND tool to be present
      const hasValidPlatform = result.platform && result.platform !== 'None';
      const isViable = hasValidPlatform ;

      return {
        viable: isViable,
        niche: result.niche,
        platform: result.platform,
        platformDomain: result['platform domain'] || 'None',
        tool: result.tool
      };

    } catch (error) {
      this.log(campaignId, 'error', `Failed to filter job: ${error.message}`);
      return { 
        viable: false, 
        niche: 'None',
        platform: 'None',
        platformDomain: 'None',
        tool: 'None'
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Generate README using appropriate prompt based on niche
   * @param {Object} jobDetails - Detailed job information
   * @param {string} niche - 'Automation' or 'Scraping'
   * @param {string} platform - Platform name from filter
   * @param {string} tool - Tool name from filter
   * @param {string} cookies - GPT account cookies
   * @returns {Promise<Object>} Parsed README data
   */
  async generateReadmeForJob(jobDetails, niche, platform, tool, cookies, campaignId) {
    this.log(campaignId, 'info', `📝 Generating ${niche} README for: ${jobDetails.title}`);
    
    const puppeteer = (await import('puppeteer')).default;
    let browser;
    
    try {
      // Choose appropriate prompt
      const promptTemplate = niche === 'Scraping' 
        ? this.prompts.scraperReadme 
        : this.prompts.automationReadme;
      
      // Build job data with metadata for prompt
      const jobDescription = upworkJobService.buildJobDescription(jobDetails);
      
      // Create metadata block
      const metadata = JSON.stringify({
        platform: platform,
        tool: tool
      }, null, 2);
      
      const fullPrompt = `${promptTemplate}\n\n====================================================\n\nUpwork Job Post:\n\nJob Title: ${jobDetails.title}\n\nJob Description: ${jobDescription}\n\nMetaData:\n${metadata}`;
      
      this.log(campaignId, 'info', 'Sending to GPT for README generation...');
      this.log(campaignId, 'info', `   Platform: ${platform}`);
      this.log(campaignId, 'info', `   Tool: ${tool}`);
      
      // Launch headless browser (same as apifyToGPTProcessor)
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: { width: 1920, height: 1080 }
      });

      const page = await browser.newPage();

      // Set realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Load cookies with sanitization
      if (cookies && Array.isArray(cookies)) {
        const sanitizedCookies = this.sanitizeCookies(cookies);
        if (sanitizedCookies.length > 0) {
          await page.setCookie(...sanitizedCookies);
        }
      }

      // Navigate to ChatGPT
      await page.goto('https://chatgpt.com/', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });

      // Wait for page load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.URL.includes('/auth/login');
      });

      if (!isLoggedIn) {
        throw new Error('Not logged in to ChatGPT. Please update GPT account cookies.');
      }

      // Wait for textarea
      await page.waitForSelector('textarea, div[contenteditable="true"]', { timeout: 30000 });

      // Send prompt using helper method (same as apifyToGPTProcessor)
      await this.sendPromptToGPT(page, fullPrompt, (msg) => this.log(campaignId, 'info', msg));

      // Wait for response to complete (longer wait for README generation)
      await this.waitForGPTResponse(page, (msg) => this.log(campaignId, 'info', msg), 8, 3000, 500);

      // Extract response
      const responseText = await this.extractGPTResponse(page);

      if (!responseText) {
        throw new Error('No response received from GPT');
      }

      this.log(campaignId, 'success', 'README generated successfully');

      // Parse the response (similar to apifyToGPTProcessor parseGPTResponse)
      return this.parseReadmeResponse(responseText, jobDetails);

    } catch (error) {
      this.log(campaignId, 'error', `Failed to generate README: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Parse README response from GPT
   */
  parseReadmeResponse(responseText, jobDetails) {
    console.log('🔍 Parsing README response from GPT...');
    
    // Extract metadata block (pgsql code fence)
    const metadataMatch = responseText.match(/```pgsql\s*\n([\s\S]*?)```/);
    
    let repoName = '';
    let description = '';
    let topics = [];
    
    if (metadataMatch) {
      const metadata = metadataMatch[1];
      console.log('✅ Found metadata block');
      
      const repoNameMatch = metadata.match(/Repo Name:\s*(.+)/);
      const descMatch = metadata.match(/Description:\s*(.+)/);
      
      // Use comprehensive topic extraction
      topics = this.extractTopicsFromMetadata(metadata);
      
      if (repoNameMatch) {
        repoName = repoNameMatch[1].trim();
        console.log(`  📦 Repo Name: "${repoName}"`);
      }
      
      if (descMatch) {
        description = descMatch[1].trim();
        console.log(`  📝 Description: ${description}`);
      }
      
      if (topics.length > 0) {
        console.log(`  🏷️  Topics extracted (${topics.length}): ${topics.join(', ')}`);
      } else {
        console.log(`  ⚠️  No topics found in metadata block`);
      }
    } else {
      console.log('⚠️  No metadata block found');
    }
    
    // Extract README markdown (second code fence)
    const readmeMatch = responseText.match(/```markdown\s*\n([\s\S]*?)```/);
    const readme = readmeMatch ? readmeMatch[1].trim() : '';
    console.log(`📄 README extracted (${readme.length} chars)`);
    
    // Fallback values
    if (!repoName) {
      repoName = jobDetails.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      console.log(`⚠️  Using fallback repo name: ${repoName}`);
    }
    
    if (!description) {
      description = jobDetails.title;
      console.log(`⚠️  Using fallback description`);
    }
    
    console.log(`✅ Parse complete - ${topics.length} topics ready`);
    
    return {
      repo_name: repoName,
      description,
      topics,
      readme
    };
  }

  /**
   * Get GPT account cookies
   */
  async getGPTCookies(gptAccountId, campaignId) {
    try {
      const account = await storage.getGPTAccount(gptAccountId);
      if (!account || !account.cookies) {
        throw new Error('GPT account cookies not found');
      }
      
      // Parse cookies if they're a string
      let cookies = account.cookies;
      if (typeof cookies === 'string') {
        try {
          cookies = JSON.parse(cookies);
        } catch (e) {
          throw new Error('Invalid cookies format');
        }
      }
      
      return cookies;
    } catch (error) {
      this.log(campaignId, 'error', `Failed to get GPT cookies: ${error.message}`);
      throw error;
    }
  }

  /**
   * Main campaign loop - REAL-TIME job detection with deduplication
   */
  async startCampaign(id) {
  console.log('\n===== STARTING UPWORK CAMPAIGN (REAL-TIME MODE) =====');
  console.log('Campaign ID:', id);
  
  if (this.running.get(id)) {
    console.log('Campaign already running');
    return;
  }

  this.running.set(id, true);
  this.setStatus(id, 'Running');
  
  // Initialize seen jobs set for this campaign
  if (!this.seenJobIds.has(id)) {
    this.seenJobIds.set(id, new Set());
  }

  const campaign = await storage.getUpworkCampaign(id);

  if (!campaign) {
    console.log('Campaign not found');
    this.running.delete(id);
    return;
  }

  console.log('Campaign found:', campaign.name);
  console.log('Search input:', campaign.upworkSearchInput);

  try {
    this.log(id, 'info', `🚀 Starting REAL-TIME Upwork campaign: ${campaign.name}`);
    this.log(id, 'info', `🔍 Search query: ${campaign.upworkSearchInput}`);
    this.log(id, 'info', `⏱️ Mode: Real-time (fetching jobs posted within 15 minutes)`);
    this.log(id, 'info', `🛡️ Duplicate detection: ENABLED`);
    
    // Get GPT cookies
    const cookies = await this.getGPTCookies(campaign.gptAccountId, id);
    
    let processed = 0;
    let viable = 0;
    let nonViable = 0;
    let duplicatesSkipped = 0; // NEW: Track duplicates
    let successfulRepos = [];
    
    const seenJobs = this.seenJobIds.get(id);
    
    // Infinite loop - continuously polls for NEW jobs
    while (this.running.get(id)) {
      try {
        this.log(id, 'info', '🔍 Scanning for new jobs posted within 15 minutes...');
        
        // Fetch recent jobs (limit 10 to catch new posts quickly)
        const jobs = await upworkJobService.fetchJobs(campaign.upworkSearchInput, 10);
        
        if (!jobs || jobs.length === 0) {
          this.log(id, 'info', 'No jobs found in this scan. Waiting 30 seconds...');
          await this.delay(30000);
          continue;
        }
        
        console.log(`📦 Fetched ${jobs.length} jobs from Upwork`);
        
        // Filter for NEW jobs (not seen before AND posted within 5 minutes)
        const newJobs = [];
        for (const job of jobs) {
          const jobId = job.id || job.ciphertext;
          
          if (!jobId) {
            continue;
          }
          
          // Skip if already processed
          if (seenJobs.has(jobId)) {
            continue;
          }
          
          // Check if posted within 5 minutes (real-time detection)
          if (!this.isJobPostedWithinMinutes(job.createdDateTime, 15)) {
            continue;
          }
          
          // Mark as seen immediately to prevent duplicates
          seenJobs.add(jobId);
          newJobs.push(job);
          this.log(id, 'success', `🆕 New job: "${job.title.substring(0, 50)}..."`);
        }
        
        if (newJobs.length === 0) {
          this.log(id, 'info', 'No new jobs posted within 15 minutes. Waiting 30 seconds...');
          await this.delay(30000);
          continue;
        }
        
        this.log(id, 'success', `✅ Found ${newJobs.length} NEW jobs to process!`);
        
        // Process each NEW job
        for (const job of newJobs) {
          // Check if campaign was stopped
          if (!this.running.get(id)) {
            this.log(id, 'info', 'Campaign stopped by user');
            break;
          }
          
          try {
            processed++;
            this.updateProgress(id, processed, processed, viable, nonViable);
            
            this.log(id, 'info', `\n📋 Processing job ${processed}: ${job.title}`);
            
            // Use simple job data (no full details fetch needed)
            this.log(id, 'info', '🤖 Filtering job with GPT (using simple data)...');
            const filterResult = await this.filterJobWithGPT(job, cookies, id);
            
            if (!filterResult.viable) {
              nonViable++;
              this.updateProgress(id, processed, processed, viable, nonViable);
              this.log(id, 'warning', `❌ Job rejected: Missing platform or tool`);
              this.log(id, 'warning', `   Platform: ${filterResult.platform}`);
              this.log(id, 'warning', `   Tool: ${filterResult.tool}`);
              continue;
            }
            
            // ====== NEW: DUPLICATE DETECTION CHECK ======
            this.log(id, 'info', '🔍 Checking for duplicate jobs in database...');
            
            const isDuplicate = await storage.checkJobDuplicate(
              job.title,
              job.description,
              0.85 // 85% similarity threshold
            );
            
            if (isDuplicate) {
              duplicatesSkipped++;
              nonViable++; // Count as non-viable for stats
              this.updateProgress(id, processed, processed, viable, nonViable);
              
              this.log(id, 'warning', `⚠️ DUPLICATE DETECTED - Skipping job`);
              this.log(id, 'warning', `   Original job: "${isDuplicate.title}"`);
              this.log(id, 'warning', `   Processed on: ${new Date(isDuplicate.createdAt).toLocaleString()}`);
              this.log(id, 'warning', `   Campaign: ${isDuplicate.campaignId}`);
              if (isDuplicate.repoUrl) {
                this.log(id, 'warning', `   Repo: ${isDuplicate.repoUrl}`);
              }
              this.log(id, 'info', `   Total duplicates skipped so far: ${duplicatesSkipped}`);
              
              continue; // Skip to next job
            }
            
            this.log(id, 'success', `✅ No duplicate found - proceeding with job`);
            // ====== END DUPLICATE CHECK ======
            
            viable++;
            this.updateProgress(id, processed, processed, viable, nonViable);
            this.log(id, 'success', `✅ Job accepted!`);
            this.log(id, 'success', `   Niche: ${filterResult.niche}`);
            this.log(id, 'success', `   Platform: ${filterResult.platform}`);
            this.log(id, 'success', `   Platform Domain: ${filterResult.platformDomain}`);
            this.log(id, 'success', `   Tool: ${filterResult.tool}`);
            
            // Get GitHub account and token
            const account = await this.getBestAccountFromGroup(campaign.accountGroupId, id);
            const githubToken = await storage.getGithubAccountToken(account.id);
            const proxyInfo = await this.getAccountProxyInfo(account.id);

            if (proxyInfo.proxyUrl) {
              this.log(id, 'info', `🔌 Using proxy for account: ${account.username}`);
              this.log(id, 'info', `   Session: ${proxyInfo.sessionId?.substring(0, 12)}...`);
            }
            
            if (!githubToken) {
              throw new Error(`No GitHub token found for account: ${account.username}`);
            }
            
            this.log(id, 'info', `🚀 Running complete workflow (using ${account.username})`);
            this.log(id, 'info', '   This includes: README generation, repo creation, and code generation');
            
            // Prepare scraped data with niche information AND metadata
            const scrapedData = {
              title: job.title,
              description: upworkJobService.buildJobDescription(job),
              niche: filterResult.niche,
              platform: filterResult.platform,
              platformDomain: filterResult.platformDomain,
              tool: filterResult.tool,
              source: 'upwork'
            };
            
            // Run complete workflow
            const workflowResult = await completeWorkflow({
              scrapedData,
              githubToken: githubToken,
              cookies,
              logFn: (msg) => this.log(id, 'info', msg),
              vaPlatform: 'bitbash',
              proxyUrl: proxyInfo.proxyUrl,
              sessionId: proxyInfo.sessionId,
              campaignId: id  // Pass campaign ID for export data storage
            });
            
            this.log(id, 'success', `✅ Successfully created: ${workflowResult.url}`);
            if (workflowResult.filesPushed > 0) {
              this.log(id, 'success', `   💻 Code files pushed: ${workflowResult.filesPushed}`);
            }
            
            // Store README in campaign database
            if (workflowResult.readme) {
              await storage.updateUpworkCampaign(id, {
                lastGeneratedReadme: workflowResult.readme,
                lastReadmeTimestamp: new Date().toISOString()
              });
              this.log(id, 'info', '💾 README stored in campaign database');
            }
            
            // Add 6-second delay after GitHub operations
            this.log(id, 'info', '⏳ Waiting 6 seconds before next operation...');
            await this.delay(6000);
            
            // ====== NEW: STORE PROCESSED JOB TO PREVENT FUTURE DUPLICATES ======
            try {
              await storage.storeProcessedJob({
                id: job.id || job.ciphertext,
                title: job.title,
                description: job.description,
                campaignId: id,
                niche: filterResult.niche,
                platform: filterResult.platform,
                tool: filterResult.tool,
                repoUrl: workflowResult.url,
                upworkJobUrl: job.url || `https://www.upwork.com/jobs/${job.id || job.ciphertext}`
              });
              
              this.log(id, 'success', `💾 Job stored in database to prevent future duplicates`);
            } catch (storeError) {
              // Don't fail the whole process if storage fails
              this.log(id, 'warning', `⚠️ Failed to store job in duplicate database: ${storeError.message}`);
            }
            // ====== END STORE PROCESSED JOB ======
            
            // Update account usage
            await this.updateAccountUsage(account.id);
            
            // Record result
            successfulRepos.push({
              jobId: job.id,
              jobTitle: job.title,
              niche: filterResult.niche,
              platform: filterResult.platform,
              tool: filterResult.tool,
              repoName: workflowResult.repoData?.repo_name || 'unknown',
              repoUrl: workflowResult.url,
              filesGenerated: workflowResult.filesGenerated || 0,
              filesPushed: workflowResult.filesPushed || 0,
              codeGenerated: workflowResult.codeGenerated || false,
              timestamp: new Date().toISOString()
            });
            
            // Save results
            await storage.updateUpworkCampaign(id, {
              results: successfulRepos
            });
            
          } catch (error) {
            this.log(id, 'error', `Failed to process job: ${error.message}`);
            // Continue with next job
          }
        }
        
        // After processing batch, wait 30 seconds before next poll
        this.log(id, 'info', '✅ Batch processed. Waiting 30 seconds before next scan...');
        if (duplicatesSkipped > 0) {
          this.log(id, 'info', `   📊 Total duplicates skipped: ${duplicatesSkipped}`);
        }
        await this.delay(30000);
        
      } catch (error) {
        this.log(id, 'error', `Error in campaign loop: ${error.message}`);
        this.log(id, 'info', 'Retrying in 30 seconds...');
        await this.delay(30000);
      }
    }
    
    this.log(id, 'success', `Campaign completed - Total duplicates prevented: ${duplicatesSkipped}`);
    this.setStatus(id, 'Completed');
    
  } catch (error) {
    this.log(id, 'error', `Campaign failed: ${error.message}`);
    this.setStatus(id, 'Failed');
  } finally {
    this.running.delete(id);
    // Clear seen jobs for this campaign
    this.seenJobIds.delete(id);
  }
}

  async stopCampaign(id) {
    console.log(`Stopping Upwork campaign: ${id}`);
    
    if (!this.running.get(id)) {
      console.log('Campaign is not running');
      return;
    }
    
    this.log(id, 'info', 'Stopping campaign...');
    this.running.delete(id);
    
    // Clear seen jobs for this campaign to allow fresh start
    if (this.seenJobIds.has(id)) {
      this.seenJobIds.delete(id);
      console.log('Cleared seen jobs cache for campaign');
    }
    
    this.setStatus(id, 'Stopped');
    console.log('Campaign stopped');
  }

  async getBestAccountFromGroup(accountGroupId, campaignId) {
  this.log(campaignId, 'info', `Selecting account from group: ${accountGroupId}`);
  
  console.log('🔍 DEBUG: Querying accounts with groupId:', accountGroupId);
  console.log('🔍 DEBUG: Type of accountGroupId:', typeof accountGroupId);
  
  const accounts = await storage.getGithubAccounts(accountGroupId);
  
  console.log('🔍 DEBUG: Accounts returned:', accounts ? accounts.length : 0);
  
  if (!accounts || accounts.length === 0) {
    throw new Error(`No accounts found in the selected group (Group ID: ${accountGroupId})`);
  }
  
  const activeAccounts = accounts.filter(acc => (acc.repoCount || 0) < 50);
  
  if (activeAccounts.length === 0) {
    throw new Error('All accounts in the group have reached the 50 repo limit');
  }
  
  activeAccounts.sort((a, b) => {
    if (!a.lastUsed) return -1;
    if (!b.lastUsed) return 1;
    return new Date(a.lastUsed) - new Date(b.lastUsed);
  });
  
  const selectedAccount = activeAccounts[0];
  
  this.log(campaignId, 'info', `Selected account: ${selectedAccount.username} (${selectedAccount.repoCount || 0} repos)`);
  
  // Log proxy info if assigned
  if (selectedAccount.assignedProxy) {
    this.log(campaignId, 'info', `  🔒 Account has assigned proxy (session: ${selectedAccount.proxySessionId?.substring(0, 12)}...)`);
  }
  
  return selectedAccount;
}

  async updateAccountUsage(accountId) {
    const account = await storage.getGithubAccountById(accountId);
    if (!account) return;
    
    await storage.updateGithubAccount(accountId, {
      lastUsed: new Date().toISOString(),
      repoCount: (account.repoCount || 0) + 1,
      status: (account.repoCount || 0) + 1 >= 50 ? 'disabled' : 'active'
    });
  }
  /**
   * Extract job ID from Upwork job URL
   * @param {string} url - Upwork job URL
   * @returns {string|null} Job ID or null if invalid
   */
  extractJobIdFromUrl(url) {
    try {
      // Handle different Upwork URL formats:
      // 1. https://www.upwork.com/jobs/~01234567890abcdef
      // 2. https://www.upwork.com/ab/proposals/job/~01234567890abcdef
      // 3. Job ID might be in URL params or path
      
      const urlObj = new URL(url);
      const pathname = urlObj.pathname || '';

      // 1) Prefer explicit ~id patterns anywhere in the pathname (returns without the ~)
      let match = pathname.match(/~([a-zA-Z0-9]+)/);
      if (match && match[1]) return match[1];

      // 2) Handle slug_~id patterns (e.g. "...slug_~0219918.../")
      match = pathname.match(/_~([a-zA-Z0-9]+)/);
      if (match && match[1]) return match[1];

      // 3) Check common query params that might contain an id
      const params = urlObj.searchParams;
      if (params.has('id')) return params.get('id');
      if (params.has('jobId')) return params.get('jobId');

      // 4) Fallback: inspect last path segment and try to extract trailing alphanumeric id
      const parts = pathname.split('/').filter(p => p.length > 0);
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        // If last part contains a ~ anywhere, return the alphanumeric after it
        match = lastPart.match(/~?([a-zA-Z0-9]+)$/);
        if (match && match[1]) return match[1];
      }

      return null;
    } catch (error) {
      console.error('Failed to extract job ID from URL:', error);
      return null;
    }
  }

  /**
   * Start a scrape-jobs campaign - processes specific job URLs
   * @param {string} id - Campaign ID
   */
  parseManualJobEntry(jobText) {
  const lines = jobText.split('\n').map(l => l.trim()).filter(l => l);
  
  const job = {
    title: '',
    description: '',
    skills: '',
    budget: '',
    duration: '',
    fullText: jobText
  };
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    if (lower.startsWith('job title:') || lower.startsWith('title:')) {
      job.title = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('description:')) {
      job.description = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('skills:') || lower.startsWith('required skills:')) {
      job.skills = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('budget:')) {
      job.budget = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('duration:')) {
      job.duration = line.split(':').slice(1).join(':').trim();
    } else if (!job.description && job.title) {
      // If we have a title but no description yet, treat remaining lines as description
      job.description += (job.description ? ' ' : '') + line;
    }
  }
  
  // Fallback: if no structured data found, use first line as title and rest as description
  if (!job.title && lines.length > 0) {
    job.title = lines[0];
    job.description = lines.slice(1).join(' ');
  }
  
  return job;
}

/**
 * Build job description for GPT from manual entry
 * @param {Object} jobEntry - Parsed job object
 * @returns {string} Formatted job description
 */
buildManualJobDescription(jobEntry) {
  const sections = [];
  
  if (jobEntry.title) {
    sections.push(`Job Title: ${jobEntry.title}`);
  }
  
  if (jobEntry.description) {
    sections.push(`\nJob Description:\n${jobEntry.description}`);
  }
  
  if (jobEntry.skills) {
    sections.push(`\nRequired Skills: ${jobEntry.skills}`);
  }
  
  if (jobEntry.budget) {
    sections.push(`\nBudget: ${jobEntry.budget}`);
  }
  
  if (jobEntry.duration) {
    sections.push(`\nDuration: ${jobEntry.duration}`);
  }
  
  return sections.join('\n');
}

/**
 * Start a scrape-jobs campaign with manual job entries
 * @param {string} id - Campaign ID
 */
async startScrapeJobsCampaign(id) {
  console.log('\n===== STARTING MANUAL JOBS CAMPAIGN =====');
  console.log('Campaign ID:', id);
  
  if (this.running.get(id)) {
    console.log('Campaign already running');
    return;
  }

  this.running.set(id, true);
  this.setStatus(id, 'Running');

  const campaign = await storage.getScrapeJobsCampaign(id);

  if (!campaign) {
    console.log('Campaign not found');
    this.running.delete(id);
    return;
  }

  console.log('Campaign found:', campaign.name);
  console.log('Manual jobs to process:', campaign.scrapeJobUrls.length);
  console.log('Selected niche:', campaign.scrapeJobNiche);

  try {
    this.log(id, 'info', `🚀 Starting Manual Jobs campaign: ${campaign.name}`);
    this.log(id, 'info', `📋 Total jobs to process: ${campaign.scrapeJobUrls.length}`);
    this.log(id, 'info', `🎯 Niche: ${campaign.scrapeJobNiche}`);
    this.log(id, 'info', `🛡️ Duplicate detection: ENABLED`);
    
    // Get GPT cookies
    const cookies = await this.getGPTCookies(campaign.gptAccountId, id);
    
    let processed = 0;
    let successfulRepos = 0;
    let duplicates = 0;
    let errors = 0;
    let results = [];
    
    // Process each manual job entry
    for (let i = 0; i < campaign.scrapeJobUrls.length; i++) {
      // Check if campaign was stopped
      if (!this.running.get(id)) {
        this.log(id, 'info', 'Campaign stopped by user');
        break;
      }

      const jobText = campaign.scrapeJobUrls[i];
      
      try {
        processed++;
        const progress = {
          processed,
          total: campaign.scrapeJobUrls.length,
          successfulRepos,
          duplicates,
          errors
        };
        await storage.updateScrapeJobsCampaign(id, { progress });
        this.emit('progress', { campaignId: id, ...progress });
        
        this.log(id, 'info', `\n📋 Processing job ${processed}/${campaign.scrapeJobUrls.length}`);
        
        // Parse manual job entry
        this.log(id, 'info', '📝 Parsing manual job entry...');
        const jobEntry = this.parseManualJobEntry(jobText);
        
        if (!jobEntry.title) {
          this.log(id, 'error', `❌ Could not parse job entry (no title found)`);
          errors++;
          
          // Update progress for parse error
          const parseErrorProgress = {
            processed,
            total: campaign.scrapeJobUrls.length,
            successfulRepos,
            duplicates,
            errors
          };
          await storage.updateScrapeJobsCampaign(id, { progress: parseErrorProgress });
          this.emit('progress', { campaignId: id, ...parseErrorProgress });
          
          continue;
        }
        
        this.log(id, 'success', `✅ Job parsed: ${jobEntry.title}`);
        
        // Check for duplicates
        this.log(id, 'info', '🔍 Checking for duplicate jobs in database...');
        
        const isDuplicate = await storage.checkJobDuplicate(
          jobEntry.title,
          jobEntry.description,
          0.85
        );
        
        if (isDuplicate) {
          duplicates++;
          const newProgress = {
            processed,
            total: campaign.scrapeJobUrls.length,
            successfulRepos,
            duplicates,
            errors
          };
          await storage.updateScrapeJobsCampaign(id, { progress: newProgress });
          this.emit('progress', { campaignId: id, ...newProgress });
          
          this.log(id, 'warning', `⚠️ DUPLICATE DETECTED - Skipping job`);
          this.log(id, 'warning', `   Original job: "${isDuplicate.title}"`);
          this.log(id, 'warning', `   Processed on: ${new Date(isDuplicate.createdAt).toLocaleString()}`);
          if (isDuplicate.repoUrl) {
            this.log(id, 'warning', `   Repo: ${isDuplicate.repoUrl}`);
          }
          this.log(id, 'info', `   Total duplicates skipped: ${duplicates}`);
          
          // Wait before next job
          if (i < campaign.scrapeJobUrls.length - 1) {
            this.log(id, 'info', `⏸️ Waiting ${Math.round(campaign.delayBetweenRepos / 1000)}s before next job...`);
            await this.delay(campaign.delayBetweenRepos);
          }
          continue;
        }
        
        this.log(id, 'success', `✅ No duplicate found - proceeding with job`);
        
        // Use user-selected niche (no GPT filtering needed)
        const niche = campaign.scrapeJobNiche;
        this.log(id, 'info', `🎯 Using selected niche: ${niche}`);
        
        // Get GitHub account and token
        const account = await this.getBestAccountFromGroup(campaign.accountGroupId, id);
        const githubToken = await storage.getGithubAccountToken(account.id);
        const proxyInfo = await this.getAccountProxyInfo(account.id);

        if (proxyInfo.proxyUrl) {
          this.log(id, 'info', `🔌 Using proxy for account: ${account.username}`);
          this.log(id, 'info', `   Session: ${proxyInfo.sessionId?.substring(0, 12)}...`);
        }
        
        if (!githubToken) {
          throw new Error(`No GitHub token found for account: ${account.username}`);
        }
        
        this.log(id, 'info', `🚀 Running complete workflow (using ${account.username})`);
        
        // Prepare scraped data from manual entry
        const scrapedData = {
          title: jobEntry.title,
          description: this.buildManualJobDescription(jobEntry),
          niche: niche,
          platform: 'None', // Manual entries don't have extracted platform/tool
          tool: 'None',
          source: 'upwork'
        };
        
        // Run complete workflow (same as live upwork campaign)
        const workflowResult = await completeWorkflow({
          scrapedData,
          githubToken: githubToken,
          cookies,
          logFn: (msg) => this.log(id, 'info', msg),
          vaPlatform: 'bitbash',
          proxyUrl: proxyInfo.proxyUrl,
          sessionId: proxyInfo.sessionId,
          campaignId: id  // Pass campaign ID for export data storage
        });
        
        this.log(id, 'success', `✅ Successfully created: ${workflowResult.url}`);
        if (workflowResult.filesPushed > 0) {
          this.log(id, 'success', `   💻 Code files pushed: ${workflowResult.filesPushed}`);
        }
        
        // Store README in campaign database
        if (workflowResult.readme) {
          await storage.updateScrapeJobsCampaign(id, {
            lastGeneratedReadme: workflowResult.readme,
            lastReadmeTimestamp: new Date().toISOString()
          });
          this.log(id, 'info', '💾 README stored in campaign database');
        }
        
        successfulRepos++;
        
        // Store processed job to prevent duplicates
        try {
          await storage.storeProcessedJob({
            id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: jobEntry.title,
            description: jobEntry.description,
            campaignId: id,
            niche: niche,
            platform: 'None',
            tool: 'None',
            repoUrl: workflowResult.url,
            upworkJobUrl: 'manual-entry'
          });
          
          this.log(id, 'success', `💾 Job stored in database to prevent future duplicates`);
        } catch (storeError) {
          this.log(id, 'warning', `⚠️ Failed to store job in duplicate database: ${storeError.message}`);
        }
        
        // Update account usage
        await this.updateAccountUsage(account.id);
        
        // Record result
        results.push({
          jobTitle: jobEntry.title,
          niche: niche,
          repoName: workflowResult.repoData?.repo_name || 'unknown',
          repoUrl: workflowResult.url,
          repoDescription: workflowResult.repoData?.description || '',
          account: account.username,
          filesGenerated: workflowResult.filesGenerated || 0,
          filesPushed: workflowResult.filesPushed || 0,
          codeGenerated: workflowResult.codeGenerated || false,
          timestamp: new Date().toISOString(),
          status: 'success'
        });
        
        // Update progress with successful repo count
        const updatedProgress = {
          processed,
          total: campaign.scrapeJobUrls.length,
          successfulRepos,
          duplicates,
          errors
        };
        
        // Save results and updated progress
        await storage.updateScrapeJobsCampaign(id, {
          results: results,
          progress: updatedProgress
        });
        this.emit('progress', { campaignId: id, ...updatedProgress });
        
        this.log(id, 'success', `📊 Progress: ${successfulRepos} repos / ${duplicates} duplicates / ${errors} errors`);
        
      } catch (error) {
        this.log(id, 'error', `❌ Failed to process job: ${error.message}`);
        errors++;
        
        // Record failed result
        results.push({
          jobText: jobText.substring(0, 100) + '...',
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        // Update progress with error count
        const errorProgress = {
          processed,
          total: campaign.scrapeJobUrls.length,
          successfulRepos,
          duplicates,
          errors
        };
        
        await storage.updateScrapeJobsCampaign(id, {
          results: results,
          progress: errorProgress
        });
        this.emit('progress', { campaignId: id, ...errorProgress });
      }
      
      // Wait before next job (unless it's the last one)
      if (i < campaign.scrapeJobUrls.length - 1 && this.running.get(id)) {
        this.log(id, 'info', `⏸️ Waiting ${Math.round(campaign.delayBetweenRepos / 1000)}s before next job...`);
        await this.delay(campaign.delayBetweenRepos);
      }
    }
    
    this.log(id, 'success', `\n✅ Campaign completed!`);
    this.log(id, 'success', `   📊 Final stats:`);
    this.log(id, 'success', `   - Total processed: ${processed}`);
    this.log(id, 'success', `   - Repos created: ${successfulRepos}`);
    this.log(id, 'success', `   - Duplicates skipped: ${duplicates}`);
    this.log(id, 'success', `   - Errors: ${errors}`);
    
    this.setStatus(id, 'Completed');
    
  } catch (error) {
    this.log(id, 'error', `Campaign failed: ${error.message}`);
    this.setStatus(id, 'Failed');
  } finally {
    this.running.delete(id);
  }
}


  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getCampaignLogs(id) {
    console.log(`Getting logs for Upwork campaign: ${id}`);
    return storage.getLogs(id);
  }
}

export const upworkCampaignManager = new UpworkCampaignManager();