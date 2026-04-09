/**
 * COMPLETE WORKFLOW - Fixed for HTML-stripped data
 */

import { processApifyDataWithChatGPT, injectBrandingSections } from './apifyToGPTProcessor.js';
import { 
  extractDirectoryStructure,
  buildCodeGenerationPrompt,
  generateCodeWithGPT,
  parseCodeResponse,
  cleanFilePath,
  isValidFilePath
} from './Codegenerator.js';
import { writeFilesToDisk } from './gptFileWriter.js';
import { 
  createRepository, 
  updateReadme, 
  addTopics, 
  verifyToken,
  getDefaultGitHubToken 
} from './githubService.js';
import { pushDirectoryToGitHub } from './Githubfilepusher.js';
import { storage } from './storage.js';
import path from 'path';


/**
 * Push files to GitHub with retry logic
 */
async function pushFilesWithRetry({ owner, repo, files, token, logFn = console.log, maxRetries = 3, batchSize = 5 }) {
  logFn(`\n📦 ===== PUSHING ${files.length} FILES TO GITHUB =====`);
  logFn(`👤 Owner: ${owner}`);
  logFn(`📦 Repository: ${repo}`);
  logFn(`📁 Total files: ${files.length}`);
  logFn(`🔄 Max retries: ${maxRetries}`);
  logFn(`📦 Batch size: ${batchSize}\n`);
  
  const results = [];
  const delayMs = 1200;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    logFn(`\n[${i + 1}/${files.length}] Processing: ${file.filepath}`);
    logFn(`  📏 Size: ${(file.code || file.content).length} characters`);
    
    let success = false;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const content = file.code || file.content;
        const b64Content = Buffer.from(content, 'utf-8').toString('base64');
        
        const axios = (await import('axios')).default;
        
        await axios.request({
          method: 'put',
          url: `https://api.github.com/repos/${owner}/${repo}/contents/${file.filepath}`,
          headers: { 
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          data: JSON.stringify({
            message: `feat: add ${file.filepath}`,
            content: b64Content
          })
        });
        
        logFn(`  ✅ Pushed successfully`);
        success = true;
        results.push({ success: true, filepath: file.filepath });
        break;
        
      } catch (error) {
        lastError = error.response?.data?.message || error.message;
        logFn(`  ⚠️ Attempt ${attempt}/${maxRetries} failed: ${lastError}`);
        
        if (attempt < maxRetries) {
          const retryDelay = delayMs * attempt;
          logFn(`  ⏳ Waiting ${retryDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    if (!success) {
      logFn(`  ❌ Failed after ${maxRetries} attempts`);
      results.push({ success: false, filepath: file.filepath, error: lastError });
    }
    
    // Add delay between files (except last)
    if (i < files.length - 1) {
      logFn(`  ⏳ Waiting ${delayMs}ms before next file...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  logFn(`\n📊 ===== PUSH SUMMARY =====`);
  logFn(`✅ Successful: ${successful}/${files.length}`);
  logFn(`❌ Failed: ${failed}/${files.length}`);
  
  if (failed > 0) {
    logFn('\n❌ Failed files:');
    results.filter(r => !r.success).forEach(r => {
      logFn(`  - ${r.filepath}: ${r.error}`);
    });
  }
  
  logFn(`==========================\n`);
  
  return {
    total: files.length,
    successful,
    failed,
    results
  };
}

/**
 * Log file structure
 */
function logFileStructure(files, logFn = console.log) {
  logFn('\n📂 ===== FILE STRUCTURE =====');
  
  const tree = {};
  files.forEach(file => {
    const parts = file.filepath.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // File
        if (!current._files) current._files = [];
        current._files.push(part);
      } else {
        // Directory
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    });
  });
  
  function printTree(node, prefix = '', name = '') {
    if (name) {
      logFn(`${prefix}${name}/`);
    }
    
    const dirs = Object.keys(node).filter(k => k !== '_files');
    const files = node._files || [];
    
    dirs.forEach((dir, index) => {
      const isLast = index === dirs.length - 1 && files.length === 0;
      const connector = isLast ? '└── ' : '├── ';
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(node[dir], newPrefix, connector + dir);
    });
    
    files.forEach((file, index) => {
      const isLast = index === files.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      logFn(`${prefix}${connector}${file}`);
    });
  }
  
  printTree(tree);
  logFn('============================\n');
}

/**
 * Validate parsed files
 */
function validateParsedFiles(files) {
  console.log('🔍 Validating parsed files...');
  
  const validFiles = files.filter(file => {
    // Must have filepath
    if (!file.filepath || typeof file.filepath !== 'string') {
      console.log(`  ⚠️ Skipping: missing filepath`);
      return false;
    }
    
    // Must have code/content
    const content = file.code || file.content;
    if (!content || typeof content !== 'string' || content.length < 10) {
      console.log(`  ⚠️ Skipping ${file.filepath}: no valid content`);
      return false;
    }
    
    // Must have file extension
    if (!/\.[a-zA-Z0-9]{1,10}$/.test(file.filepath)) {
      console.log(`  ⚠️ Skipping ${file.filepath}: no file extension`);
      return false;
    }
    
    return true;
  });
  
  console.log(`✅ Validated: ${validFiles.length}/${files.length} files are valid\n`);
  return validFiles;
}

/**
 * Parse directory structure to allowed paths
 */
function parseDirectoryStructureToPaths(directoryStructure, repoName) {
  console.log('📂 Parsing directory structure to paths...');
  
  const paths = new Set();
  const lines = directoryStructure.split('\n');
  
  for (const line of lines) {
    // Remove tree characters
    const cleaned = line
      .replace(/[│├└─\s]/g, '')
      .replace(/^[├└│─\s]+/, '')
      .trim();
    
    if (!cleaned || cleaned.length === 0) continue;
    
    // Check if it's a file
    const hasExtension = /\.[a-zA-Z0-9]{1,10}$/.test(cleaned);
    
    // Extract just the filename (last segment) for known bare file check
    const lastSegment = cleaned.split('/').pop() || '';
    const isKnownBareFile = /^(LICENSE|NOTICE|CONTRIBUTING|CHANGELOG|README|Makefile|Dockerfile|COPYING|AUTHORS|requirements|setup\.py|Gemfile|Rakefile|Procfile|\.gitignore|\.dockerignore|\.env\.example)$/i.test(lastSegment);
    
    // Accept files with extensions OR known bare filenames
    if (hasExtension || isKnownBareFile) {
      paths.add(cleaned.toLowerCase());
      paths.add(cleaned.toLowerCase().replace(/^\/+/, ''));
    }
  }
  
  console.log(`✅ Extracted ${paths.size} file paths from directory structure\n`);
  return paths;
}

/**
 * Complete workflow - Works with HTML-stripped data
 */
async function completeWorkflow({ 
  scrapedData, 
  githubToken, 
  gptReadmeResponse,
  cookies = null,
  logFn = console.log,
  vaPlatform = null,
  proxyUrl = null,      // NEW: Proxy URL
  sessionId = null,
  campaignId = null     // NEW: Campaign ID for export data storage

}) {
  logFn('\n🚀 ===== STARTING COMPLETE WORKFLOW =====\n');
  if (proxyUrl) {
    logFn(`🔌 Using proxy with sticky session: ${sessionId?.substring(0, 12)}...`);
  }
  
  // Validate token
  if (!githubToken) {
    throw new Error('GitHub token is required. Please provide a valid token.');
  }
  
  const token = githubToken;
  let repoData = null;
  let githubRepo = null;
  
  try {
    // ===== STEP 1: Verify GitHub Token =====
    logFn('🔐 Step 1: Verifying GitHub token...');
    const tokenVerification = await verifyToken(token, proxyUrl, sessionId);
    
    if (!tokenVerification.valid) {
      throw new Error(`GitHub token is invalid: ${tokenVerification.error}`);
    }
    
    const githubUsername = tokenVerification.user.login;
    logFn(`✅ Token verified! Username: ${githubUsername}\n`);
    
    // ===== STEP 2: Process with ChatGPT or Use Provided Data =====
    logFn('🤖 Step 2: Processing repository data...');
    

    // Check if gptReadmeResponse is already a parsed object (VA campaign)
    if (gptReadmeResponse && typeof gptReadmeResponse === 'object' && gptReadmeResponse.repo_name) {
      logFn('✅ Using pre-parsed repository data (VA Campaign)');
      repoData = gptReadmeResponse;
      
      // ===== INJECT BRANDING FOR VA CAMPAIGN =====
      if (vaPlatform) {
        logFn(`🎨 Injecting ${vaPlatform} branding into README...`);
        // Ensure branding callout uses the actual repository name
        repoData.readme = injectBrandingSections(repoData.readme, repoData.repo_name, vaPlatform);
        logFn(`✅ Branding injected (README length: ${repoData.readme.length} chars)`);
      }
    } else {
      // Process with ChatGPT (Apify/Upwork campaign)
      logFn('📤 Sending data to ChatGPT for processing...');
      // For Upwork campaigns, skip branding initially to store clean README
      const skipBranding = scrapedData?.source === 'upwork';
      repoData = await processApifyDataWithChatGPT(scrapedData, logFn, cookies, vaPlatform || 'bitbash', skipBranding);
    }

    
    logFn('✅ Repository data ready');
    logFn(`  📦 Repo: ${repoData.repo_name}`);
    logFn(`  📝 Description: ${repoData.description?.substring(0, 100) || 'N/A'}...`);
    logFn(`  🏷️ Topics: ${repoData.topics?.length || 0}`);
    logFn(`  📄 README: ${repoData.readme?.length || 0} chars\n`);
    
    // ===== STEP 2.5: Store Export Data for Upwork Campaigns (BEFORE HTML injection) =====
    if (campaignId && scrapedData?.source === 'upwork') {
      logFn('💾 Step 2.5: Storing export data for Upwork campaign...');
      
      try {
        // Determine category from niche
        const category = scrapedData.niche?.toLowerCase().includes('scraper') || 
                        scrapedData.niche?.toLowerCase().includes('scraping')
          ? 'scraper'
          : 'automation';
        
        // Store the CLEAN README without HTML branding
        // Use repoData.repo_name as the title (the generated repo name, not the job title)
        await storage.storeDataToExport({
          campaignId: campaignId,
          title: repoData.repo_name,  // Use generated repo name instead of job title
          description: repoData.description || repoData.about || '',
          topics: repoData.topics || [],
          readme: repoData.readme || '',  // Clean README without HTML
          category: category,
          platformDomain: scrapedData.platformDomain || 'None'
        });
        
        logFn(`✅ Export data stored successfully (clean README without HTML)`);
        logFn(`   Category: ${category}`);
        logFn(`   Platform Domain: ${scrapedData.platformDomain || 'None'}`);
        logFn(`   Title (Repo Name): ${repoData.repo_name}`);
        logFn(`   Topics: ${repoData.topics?.length || 0}\n`);
      } catch (exportError) {
        logFn(`⚠️ Warning: Failed to store export data: ${exportError.message}`);
        logFn('   Continuing with workflow...\n');
      }
    }
    
    // ===== STEP 2.6: Inject HTML Branding for Upwork Campaigns (AFTER storage) =====
    if (scrapedData?.source === 'upwork' && vaPlatform) {
      logFn('🎨 Step 2.6: Injecting HTML branding into README for GitHub...');
      repoData.readme = injectBrandingSections(repoData.readme, repoData.repo_name, vaPlatform);
      logFn(`✅ HTML branding injected (README length: ${repoData.readme.length} chars)\n`);
    }
    
    // ===== STEP 3: Create GitHub Repository =====

    logFn('🏗️ Step 3: Creating GitHub repository...');
    logFn(`📦 Using repo name: "${repoData.repo_name}"`);
    
    githubRepo = await createRepository({
      name: repoData.repo_name,
      description: repoData.about || repoData.description,
      token,
      proxyUrl,      // Pass proxy
      sessionId      // Pass session ID
    });
    
    logFn(`✅ Repository created!`);
    logFn(`  🔗 URL: ${githubRepo.html_url}\n`);
    
    // ===== STEP 4: Push README =====
    logFn('📝 Step 4: Pushing README to repository...');
    
    // Determine media folder based on platform
    let mediaFolderPath;
    if (vaPlatform === 'appilot') {
      mediaFolderPath = path.resolve(process.cwd(), 'src', 'services', 'appilot');
      logFn('📁 Using Appilot media folder');
    } else {
      mediaFolderPath = path.resolve(process.cwd(), 'src', 'services', 'media');
      logFn('📁 Using BitBash media folder');
    }
    
      await updateReadme({
      owner: githubUsername,
      repo: repoData.repo_name,
      content: repoData.readme,
      token,
      mediaFolderPath,
      mediaRepoPath: 'media',
      vaPlatform,
      proxyUrl,      // Pass proxy
      sessionId      // Pass session ID
    });
    
    logFn(`✅ README pushed successfully!\n`);
    
    // Store the README content for database storage
    const readmeContent = repoData.readme;
    
    // ===== STEP 5: Add Topics =====
    logFn(`\n🔍 Step 5: Checking topics data...`);
    logFn(`  📊 repoData.topics type: ${typeof repoData.topics}`);
    logFn(`  📊 repoData.topics value: ${JSON.stringify(repoData.topics)}`);
    
    if (repoData.topics && Array.isArray(repoData.topics) && repoData.topics.length > 0) {
      logFn(`🏷️ Step 5: Adding ${repoData.topics.length} repository topics...`);
      logFn(`  Topics to add: ${repoData.topics.join(', ')}`);
      
      await addTopics({
        owner: githubUsername,
        repo: repoData.repo_name,
        topics: repoData.topics,
        token,
        proxyUrl,      // Pass proxy
        sessionId      // Pass session ID
      });
      
      logFn(`✅ Topics added successfully!\n`);
    } else {
      logFn('⏭️ Step 5: Skipping topics (none provided or invalid format)');
      if (repoData.topics) {
        logFn(`  ⚠️  Topics exist but invalid: ${JSON.stringify(repoData.topics)}`);
      }
      logFn('');
    }
    
    // ===== STEP 6: Check for Directory Structure =====
    // logFn('📂 Step 6: Checking for directory structure in README...');
    // const directoryStructure = extractDirectoryStructure(repoData.readme);
    
    // if (!directoryStructure) {
    //   logFn('⚠️ No directory structure found in README');
    //   logFn('⏭️ Skipping code generation - workflow complete\n');
      
    //   logFn('✅ ===== WORKFLOW COMPLETED (README ONLY) =====');
    //   logFn(`📦 Repository: ${githubRepo.html_url}`);
    //   logFn(`📝 README: ✅ Pushed`);
    //   logFn(`🏷️ Topics: ✅ Added (${repoData.topics?.length || 0})`);
    //   logFn('============================================\n');
      
    //   return {
    //     success: true,
    //     repository: githubRepo,
    //     repoData,
    //     url: githubRepo.html_url,
    //     codeGenerated: false,
    //     message: 'README created successfully - No directory structure found for code generation'
    //   };
    // }
    
    // logFn('✅ Directory structure found in README!\n');
    
    // ===== STEP 7: Build Code Generation Prompt =====
    // logFn('💻 Step 7: Building code generation prompt from README...');
    
    // const codePrompt = buildCodeGenerationPrompt(repoData.readme);
    
    // logFn('✅ Code generation prompt built\n');
    
    // // ===== STEP 8: Generate Code with GPT =====
    // logFn('🤖 Step 8: Generating complete project code with GPT...');
    
    // const codeResponse = await generateCodeWithGPT(codePrompt, logFn);
    
    // logFn('✅ Code generation complete!\n');
    
    // // ===== STEP 9: Parse Generated Code =====
    // logFn('🔍 Step 9: Parsing generated code files...');
    
    // let files = parseCodeResponse(codeResponse);
    
    // if (files.length === 0) {
    //   logFn('⚠️ No files extracted from GPT response');
    //   logFn('⚠️ Code generation failed - keeping README only\n');
      
    //   return {
    //     success: true,
    //     repository: githubRepo,
    //     repoData,
    //     url: githubRepo.html_url,
    //     codeGenerated: false,
    //     filesGenerated: 0,
    //     filesPushed: 0,
    //     message: 'README created but code parsing failed'
    //   };
    // }
    
    // logFn(`✅ Successfully parsed ${files.length} code files\n`);
    
    // // ===== STEP 10: Validate Parsed Files =====
    // logFn('✓ Step 10: Validating parsed files...');
    
    // files = validateParsedFiles(files);
    
    // if (files.length === 0) {
    //   logFn('❌ No valid files after validation');
      
    //   return {
    //     success: true,
    //     repository: githubRepo,
    //     repoData,
    //     url: githubRepo.html_url,
    //     codeGenerated: false,
    //     filesGenerated: 0,
    //     filesPushed: 0,
    //     message: 'README created but no valid code files'
    //   };
    // }
    
    // logFn(`✅ ${files.length} valid files ready to push\n`);
    
    // // ===== STEP 11: Filter Files Based on Directory Structure =====
    // logFn('🔍 Step 11: Filtering files based on directory structure...');
    
    // try {
    //   const allowedPaths = parseDirectoryStructureToPaths(directoryStructure, repoData.repo_name);
      
    //   if (allowedPaths.size > 0) {
    //     const filteredFiles = files.filter(file => {
    //       const normalizedPath = file.filepath.toLowerCase();
    //       return allowedPaths.has(normalizedPath) || 
    //              allowedPaths.has(normalizedPath.replace(/^\/+/, ''));
    //     });
        
    //     if (filteredFiles.length > 0) {
    //       logFn(`✅ Filtered to ${filteredFiles.length} files matching directory structure`);
    //       files = filteredFiles;
    //     } else {
    //       logFn('⚠️ No files matched directory structure, keeping all files');
    //     }
    //   }
    // } catch (error) {
    //   logFn(`⚠️ Directory filtering failed: ${error.message}`);
    //   logFn('⚠️ Proceeding with all parsed files\n');
    // }
    
    // // ===== STEP 12: Log File Structure =====
    // logFileStructure(files, logFn);
    
    // // ===== STEP 13: Clean File Paths =====
    // logFn('🧹 Step 13: Cleaning file paths...');
    
    // const cleanedFiles = files.map(file => {
    //   let filepath = cleanFilePath(file.filepath, repoData.repo_name);
      
    //   // Additional validation after cleaning
    //   if (!isValidFilePath(filepath)) {
    //     logFn(`  ⚠️ Warning: Cleaned path still invalid: "${filepath}"`);
    //   }
      
    //   return { ...file, filepath };
    // });
    
    // // Final filter to remove any invalid paths that slipped through
    // const finalFiles = cleanedFiles.filter(f => isValidFilePath(f.filepath));
    
    // if (finalFiles.length < cleanedFiles.length) {
    //   logFn(`  ⚠️ Removed ${cleanedFiles.length - finalFiles.length} invalid paths after cleaning`);
    // }
    
    // logFn(`✅ Cleaned ${finalFiles.length} file paths\n`);
    
    // if (finalFiles.length === 0) {
    //   logFn('❌ No valid files remain after cleaning');
      
    //   return {
    //     success: true,
    //     repository: githubRepo,
    //     repoData,
    //     url: githubRepo.html_url,
    //     codeGenerated: false,
    //     filesGenerated: 0,
    //     filesPushed: 0,
    //     message: 'README created but all file paths were invalid'
    //   };
    // }
    // try {
    //   // Ensure a LICENSE file exists in the root of the repo when pushing
    //   // If the GPT output did not include a LICENSE, add an MIT license that
    //   // includes the project name and current year.
    //   const hasLicense = cleanedFiles.some(f => (f.filepath || '').toLowerCase() === 'license');
    //   if (!hasLicense) {
    //     const year = new Date().getFullYear();
    //     const licenseContent = `MIT License\n\nCopyright (c) ${year} ${repoData.repo_name}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;

    //     // Add LICENSE at root
    //     cleanedFiles.unshift({ filepath: 'LICENSE', code: licenseContent });
    //     logFn(`ℹ️ Added LICENSE to files to push (root): ${repoData.repo_name}`);
    //   }

    //   const localBase = path.resolve(process.cwd(), 'generated-project', repoData.repo_name);
    //   logFn('💾 Step 14: Writing generated files to disk at: ' + localBase);
    //   await writeFilesToDisk(cleanedFiles, localBase, logFn);
    //   logFn('✅ Files written to local generated-project folder\n');
    // } catch (err) {
    //   logFn('⚠️ Failed to write files locally: ' + err.message + '\n');
    // }
    
    // // ===== STEP 14: Push Code Files to GitHub =====
    // logFn('📤 Step 14: Pushing code files to GitHub with retry logic...');
    
    // // Instead of pushing files one-by-one from memory, push the entire
    // // local generated-project/<repo> directory. This avoids any mismatch
    // // between on-disk (sanitized) files and in-memory content.
    // const localBaseForPush = path.resolve(process.cwd(), 'generated-project', repoData.repo_name);
    // logFn(`📤 Pushing local directory to GitHub: ${localBaseForPush}`);
    // const pushResults = await pushDirectoryToGitHub({
    //     owner: githubUsername,
    //     repo: repoData.repo_name,
    //     localPath: localBaseForPush,
    //     repoPath: '',
    //     token,
    //     logFn,
    //     maxRetries: 3,
    //     batchSize: 5,
    //     proxyUrl,      // Pass proxy
    //     sessionId      // Pass session ID
    //   });
    
    // logFn(`✅ Code files pushed!`);
    // logFn(`  📁 Total files: ${pushResults.total}`);
    // logFn(`  ✅ Successful: ${pushResults.successful}`);
    // logFn(`  ❌ Failed: ${pushResults.failed}\n`);
    
    // // ===== FINAL SUMMARY =====
    // logFn('🎉 ===== WORKFLOW COMPLETED SUCCESSFULLY =====');
    // logFn(`📦 Repository: ${githubRepo.html_url}`);
    // logFn(`👤 Owner: ${githubUsername}`);
    // logFn(`📛 Full Name: ${githubRepo.full_name}`);
    // logFn(`📝 README: ✅ Pushed`);
    // logFn(`🏷️ Topics: ✅ Added (${repoData.topics?.length || 0})`);
    // logFn(`💻 Code Files Generated: ${files.length}`);
    // logFn(`📁 Code Files Pushed: ${pushResults.successful}/${pushResults.total}`);
    
    // if (pushResults.failed > 0) {
    //   logFn(`⚠️ ${pushResults.failed} files failed to push`);
    // }
    
    logFn(`🔗 View repository: ${githubRepo.html_url}`);
    logFn('============================================\n');
    
    // ===== RETURN SUCCESS WITH README =====
    logFn('✅ ===== WORKFLOW COMPLETED =====');
    logFn(`📦 Repository: ${githubRepo.html_url}`);
    logFn(`📝 README: ✅ Pushed`);
    logFn(`🏷️ Topics: ✅ Added`);
    logFn('======================================\n');
    
    return {
      success: true,
      repository: githubRepo,
      repoData,
      url: githubRepo.html_url,
      readme: readmeContent,  // Include README for DB storage
      message: 'Repository created successfully with README'
      // codeGenerated: true,
      // filesGenerated: files.length,
      // filesPushed: pushResults.successful,
      // filesFailed: pushResults.failed,
      // codeResults: pushResults
    };
    
  } catch (error) {
    logFn('\n❌ ===== WORKFLOW FAILED =====');
    logFn(`Error: ${error.message}`);
    logFn(`Stack: ${error.stack}`);
    logFn('==============================\n');
    
    if (githubRepo) {
      logFn('⚠️ Note: Repository was created but workflow failed.');
      logFn(`   Repository URL: ${githubRepo.html_url}`);
      logFn(`   You may want to check it or delete it manually.\n`);
    }
    
    throw error;
  }
}

export {
  completeWorkflow,
  pushFilesWithRetry,
  logFileStructure,
  validateParsedFiles,
  parseDirectoryStructureToPaths
};