/**
 * GitHub File Pusher with Proxy Support
 * Handles pushing multiple files to GitHub with automatic directory creation
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import path from 'path';

/**
 * Create axios config with proxy support
 */
function createProxyConfig(proxyUrl = null, sessionId = null) {
  const config = {};
  
  if (proxyUrl) {
    try {
      let finalProxyUrl = proxyUrl;
      
      if (sessionId) {
        const proxyUrlObj = new URL(proxyUrl);
        if (proxyUrlObj.username) {
          const newUsername = `${proxyUrlObj.username}-session-${sessionId}`;
          proxyUrlObj.username = newUsername;
          finalProxyUrl = proxyUrlObj.toString();
        }
      }
      
      const proxyAgent = new HttpsProxyAgent(finalProxyUrl);
      config.httpsAgent = proxyAgent;
      config.proxy = false;
      
    } catch (error) {
      console.error('⚠️ Failed to configure proxy:', error.message);
    }
  }
  
  return config;
}

/**
 * Push a single file to GitHub with proxy support
 */
async function pushSingleFile({ 
  owner, 
  repo, 
  filepath, 
  content, 
  token, 
  message = null,
  proxyUrl = null,
  sessionId = null
}) {
  try {
    let b64Content;
    
    if (Buffer.isBuffer(content)) {
      b64Content = content.toString('base64');
      console.log(`  📦 Binary content: ${content.length} bytes`);
    } else {
      const fullContent = String(content);
      const lines = fullContent.split('\n').length;
      const chars = fullContent.length;
      
      console.log(`  📏 Content stats: ${chars.toLocaleString()} chars, ${lines} lines`);
      
      if (chars === 0) {
        console.warn(`  ⚠️ Empty content for ${filepath}`);
        return { success: false, filepath, error: 'Empty content' };
      }
      
      b64Content = Buffer.from(fullContent, 'utf-8').toString('base64');
      
      const decodedLength = Buffer.from(b64Content, 'base64').toString('utf-8').length;
      if (decodedLength !== chars) {
        console.error(`  ❌ Base64 encoding error! Original: ${chars}, Decoded: ${decodedLength}`);
        throw new Error('Content encoding verification failed');
      }
      
      console.log(`  ✅ Base64 encoded: ${b64Content.length} chars (verified)`);
    }
    
    const commitMessage = message || `feat: add ${filepath}`;
    
    const data = JSON.stringify({
      message: commitMessage,
      content: b64Content
    });
    
    const proxyConfig = createProxyConfig(proxyUrl, sessionId);
    
    const config = {
      method: 'put',
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${filepath}`,
      headers: { 
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      ...proxyConfig,
      data: data
    };
    
    const response = await axios.request(config);
    
    const pushedSize = response.data.content?.size || 0;
    console.log(`  ✅ Pushed ${filepath}`);
    console.log(`     GitHub reports: ${pushedSize} bytes`);
    
    return { success: true, filepath, size: pushedSize };
    
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error(`  ❌ Failed to push ${filepath}:`);
    console.error(`     ${errorMsg}`);
    
    if (error.response?.status) {
      console.error(`     HTTP ${error.response.status}`);
    }
    
    return { success: false, filepath, error: errorMsg };
  }
}

/**
 * Push all files to GitHub repository with proxy support
 */
async function pushAllFilesToGitHub({ 
  owner, 
  repo, 
  files, 
  token, 
  logFn = console.log,
  proxyUrl = null,
  sessionId = null
}) {
  logFn('\n📤 ===== PUSHING FILES TO GITHUB =====');
  if (proxyUrl) {
    logFn(`🔌 Using proxy with session: ${sessionId?.substring(0, 12)}...`);
  }
  
  const results = {
    total: files.length,
    successful: 0,
    failed: 0,
    details: []
  };
  
  const sortedFiles = [...files].sort((a, b) => {
    const depthA = (a.filepath.match(/\//g) || []).length;
    const depthB = (b.filepath.match(/\//g) || []).length;
    return depthA - depthB;
  });
  
  logFn(`📁 Pushing ${files.length} files...`);
  logFn(`⏳ This may take a few minutes...\n`);
  
  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    
    logFn(`📄 [${i + 1}/${sortedFiles.length}] ${file.filepath}`);
    
    try {
      const result = await pushSingleFile({
        owner,
        repo,
        filepath: file.filepath,
        content: file.code,
        token,
        proxyUrl,
        sessionId
      });
      
      if (result.success) {
        logFn(`  ✅ Success`);
        results.successful++;
        results.details.push(result);
      } else {
        logFn(`  ❌ Failed: ${result.error}`);
        results.failed++;
        results.details.push(result);
      }
      
      if (i < sortedFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      logFn(`  ❌ Error: ${error.message}`);
      results.failed++;
      results.details.push({
        success: false,
        filepath: file.filepath,
        error: error.message
      });
    }
  }
  
  logFn('\n=====================================\n');
  
  return results;
}

/**
 * Push files in batches with retry logic and proxy support
 */
async function pushFilesWithRetry({ 
  owner, 
  repo, 
  files, 
  token, 
  logFn = console.log,
  maxRetries = 3,
  batchSize = 5,
  proxyUrl = null,
  sessionId = null
}) {
  logFn('\n📤 ===== PUSHING FILES WITH RETRY =====');
  if (proxyUrl) {
    logFn(`🔌 Using proxy with session: ${sessionId?.substring(0, 12)}...`);
  }
  
  const results = {
    total: files.length,
    successful: 0,
    failed: 0,
    details: []
  };
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    logFn(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}`);
    
    for (const file of batch) {
      let attempts = 0;
      let success = false;
      let lastError = null;
      
      while (attempts < maxRetries && !success) {
        attempts++;
        
        try {
          const result = await pushSingleFile({
            owner,
            repo,
            filepath: file.filepath,
            content: file.code,
            token,
            proxyUrl,
            sessionId
          });
          
          if (result.success) {
            logFn(`  ✅ ${file.filepath}`);
            results.successful++;
            results.details.push(result);
            success = true;
          } else {
            lastError = result.error;
            if (attempts < maxRetries) {
              logFn(`  ⚠️ ${file.filepath} - Retry ${attempts}/${maxRetries}`);
              await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
            }
          }
          
        } catch (error) {
          lastError = error.message;
          if (attempts < maxRetries) {
            logFn(`  ⚠️ ${file.filepath} - Retry ${attempts}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          }
        }
      }
      
      if (!success) {
        logFn(`  ❌ ${file.filepath} - Failed after ${maxRetries} attempts: ${lastError}`);
        results.failed++;
        results.details.push({
          success: false,
          filepath: file.filepath,
          error: lastError
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (i + batchSize < files.length) {
      logFn(`⏳ Waiting before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  logFn('\n========================================\n');
  
  return results;
}

/**
 * Push a local directory recursively to GitHub with proxy support
 */
async function pushDirectoryToGitHub({ 
  owner, 
  repo, 
  localPath, 
  repoPath = '', 
  token, 
  logFn = console.log, 
  maxRetries = 3, 
  batchSize = 5,
  proxyUrl = null,
  sessionId = null
}) {
  logFn(`\n📁 ===== PUSH DIRECTORY: ${localPath} -> ${owner}/${repo}/${repoPath || '<root>'} =====`);
  if (proxyUrl) {
    logFn(`🔌 Using proxy with session: ${sessionId?.substring(0, 12)}...`);
  }

  const absLocalPath = path.resolve(localPath);
  try {
    const stats = fs.statSync(absLocalPath);
    if (!stats.isDirectory()) {
      throw new Error('Provided localPath is not a directory');
    }
  } catch (err) {
    logFn('❌ Directory not found:', absLocalPath);
    throw err;
  }

  function collectFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(full));
      } else if (entry.isFile()) {
        const rel = path.relative(absLocalPath, full).split(path.sep).join('/');
        const repoFilepath = repoPath ? `${repoPath.replace(/\\/g, '/')}/${rel}` : rel;
        const content = fs.readFileSync(full);
        results.push({ filepath: repoFilepath, code: content });
      }
    }
    return results;
  }

  const files = collectFiles(absLocalPath);

  if (files.length === 0) {
    logFn('⚠️ No files found in directory to push.');
    return { total: 0, successful: 0, failed: 0, details: [] };
  }

  logFn(`📦 Found ${files.length} files to push.`);

  const results = await pushFilesWithRetry({ 
    owner, 
    repo, 
    files, 
    token, 
    logFn, 
    maxRetries, 
    batchSize,
    proxyUrl,
    sessionId
  });

  logFn('\n✅ Directory push complete');
  return results;
}

/**
 * Organize files by directory for better logging
 */
function organizeFilesByDirectory(files) {
  const structure = {};
  
  for (const file of files) {
    const parts = file.filepath.split('/');
    const filename = parts.pop();
    const directory = parts.length > 0 ? parts.join('/') : 'root';
    
    if (!structure[directory]) {
      structure[directory] = [];
    }
    
    structure[directory].push(filename);
  }
  
  return structure;
}

/**
 * Log file structure summary
 */
function logFileStructure(files, logFn = console.log) {
  logFn('\n📂 ===== FILE STRUCTURE SUMMARY =====');
  
  const structure = organizeFilesByDirectory(files);
  const directories = Object.keys(structure).sort();
  
  for (const dir of directories) {
    logFn(`\n📁 ${dir}/`);
    structure[dir].forEach(file => {
      logFn(`   📄 ${file}`);
    });
  }
  
  logFn('\n====================================\n');
}

export {
  pushSingleFile,
  pushAllFilesToGitHub,
  pushFilesWithRetry,
  pushDirectoryToGitHub,
  organizeFilesByDirectory,
  logFileStructure
};