import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { pushDirectoryToGitHub } from './Githubfilepusher.js';

/**
 * Create axios instance with proxy support
 * @param {string} proxyUrl - Proxy URL (http://user:pass@host:port or with session)
 * @param {string} sessionId - Unique session ID for sticky IP
 * @returns {object} Axios instance configured with proxy
 */
function createAxiosWithProxy(proxyUrl = null, sessionId = null) {
  const config = {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    }
  };
  
  if (proxyUrl) {
    try {
      // Add session ID to proxy URL for sticky sessions
      let finalProxyUrl = proxyUrl;
      
      if (sessionId) {
        // Parse proxy URL
        const proxyUrlObj = new URL(proxyUrl);
        
        // Add session parameter to proxy for sticky IP
        // Format depends on proxy provider, common formats:
        // - username-session-<sessionId>:password@host:port
        // - username:password-session-<sessionId>@host:port
        
        if (proxyUrlObj.username) {
          // Add session to username (most common format for sticky IPs)
          const newUsername = `${proxyUrlObj.username}-session-${sessionId}`;
          proxyUrlObj.username = newUsername;
          finalProxyUrl = proxyUrlObj.toString();
          
          console.log(`🔒 Using sticky proxy session: ${sessionId.substring(0, 12)}...`);
        }
      }
      
      const proxyAgent = new HttpsProxyAgent(finalProxyUrl);
      config.httpsAgent = proxyAgent;
      config.proxy = false; // Disable axios built-in proxy
      
      console.log(`🔌 Proxy configured: ${finalProxyUrl.replace(/:[^:@]+@/, ':****@')}`);
    } catch (error) {
      console.error('⚠️ Failed to configure proxy:', error.message);
      console.error('Continuing without proxy...');
    }
  }
  
  return axios.create(config);
}

/**
 * Get GitHub token from environment
 */
function getDefaultGitHubToken() {
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error('GITHUB_TOKEN not found in .env file. Please add: GITHUB_TOKEN=ghp_your_token_here');
  }
  
  return token;
}

/**
 * Verify GitHub token is valid
 * @param {string} token - GitHub personal access token
 * @param {string} proxyUrl - Optional proxy URL
 * @param {string} sessionId - Optional session ID for sticky IP
 */
async function verifyToken(token, proxyUrl = null, sessionId = null) {
  console.log('\n🔐 ===== VERIFYING GITHUB TOKEN =====');
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    const config = {
      method: 'get',
      url: 'https://api.github.com/user',
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy
    };
    
    console.log('📤 Checking token with GitHub API...');
    const response = await axios.request(config);
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    console.log('✅ Token is valid!');
    console.log('👤 Username:', response.data.login);
    console.log('📧 Email:', response.data.email || 'Not public');
    console.log('🆔 User ID:', response.data.id);
    console.log('====================================\n');
    
    return { valid: true, user: response.data };
  } catch (error) {
    console.error('❌ Token verification failed!');
    console.error('Error:', error.response?.data?.message || error.message);
    console.error('====================================\n');
    
    return { 
      valid: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

/**
 * Create a new GitHub repository
 * @param {object} options - Repository options
 * @param {string} options.name - Repository name
 * @param {string} options.description - Repository description
 * @param {string} options.token - GitHub token
 * @param {boolean} options.isPrivate - Whether repository is private
 * @param {string} options.proxyUrl - Optional proxy URL
 * @param {string} options.sessionId - Optional session ID for sticky IP
 */
async function createRepository({ name, description, token, isPrivate = false, proxyUrl = null, sessionId = null }) {
  console.log('\n🏗️ ===== CREATING GITHUB REPOSITORY =====');
  console.log('📦 Repository Name:', name);
  console.log('📝 Description:', description);
  console.log('🔒 Private:', isPrivate);
  if (proxyUrl) {
    console.log('🔌 Using proxy with session:', sessionId?.substring(0, 12) + '...');
  }
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    const data = JSON.stringify({
      name: name,
      description: description,
      auto_init: false,
      private: isPrivate
    });
    
    const config = {
      method: 'post',
      url: 'https://api.github.com/user/repos',
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy,
      data: data
    };
    
    console.log('📤 Sending request to GitHub API...');
    const response = await axios.request(config);
    
    console.log('✅ Repository created successfully!');
    console.log('🔗 URL:', response.data.html_url);
    console.log('👤 Owner:', response.data.owner.login);
    console.log('📛 Full Name:', response.data.full_name);
    console.log('=========================================\n');
    
    // Add 6-second delay after GitHub API call
    console.log('⏳ Waiting 6 seconds after repository creation...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    return response.data;
    
  } catch (error) {
    console.error('\n❌ ===== GITHUB REPOSITORY CREATION FAILED =====');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.response?.data?.message || error.message);
    
    if (error.response?.status === 422) {
      console.error('Reason: Repository already exists or name is invalid');
      throw new Error(`Repository "${name}" already exists or name is invalid`);
    }
    
    if (error.response?.status === 401) {
      console.error('Reason: Authentication failed');
      throw new Error('GitHub authentication failed. Please check your GitHub token');
    }
    
    if (error.response?.status === 403) {
      console.error('Reason: Rate limit exceeded or insufficient permissions');
      throw new Error('GitHub API rate limit exceeded or insufficient permissions');
    }
    
    console.error('===============================================\n');
    throw new Error(`Failed to create repository: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Update or create README.md in repository
 * @param {object} options - Update options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} options.content - README content
 * @param {string} options.token - GitHub token
 * @param {string} options.mediaFolderPath - Optional media folder path
 * @param {string} options.mediaRepoPath - Optional media repo path
 * @param {string} options.vaPlatform - Optional VA platform
 * @param {string} options.proxyUrl - Optional proxy URL
 * @param {string} options.sessionId - Optional session ID for sticky IP
 */
async function updateReadme({ 
  owner, 
  repo, 
  content, 
  token, 
  mediaFolderPath, 
  mediaRepoPath = 'media', 
  vaPlatform = null,
  proxyUrl = null,
  sessionId = null
}) {
  console.log('\n📝 ===== UPDATING README =====');
  console.log('👤 Owner:', owner);
  console.log('📦 Repo:', repo);
  console.log('📄 Content length:', content.length, 'characters');
  if (vaPlatform) {
    console.log('🎨 Platform:', vaPlatform);
  }
  if (proxyUrl) {
    console.log('🔌 Using proxy with session:', sessionId?.substring(0, 12) + '...');
  }
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    console.log('🔄 Converting content to base64...');
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    console.log('✅ Content encoded');
    
    // Check if README already exists
    let existingSha = null;
    try {
      console.log('🔍 Checking if README already exists...');
      const getConfig = {
        method: 'get',
        url: `https://api.github.com/repos/${owner}/${repo}/contents/README.md`,
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          ...axiosInstance.defaults.headers
        },
        httpsAgent: axiosInstance.defaults.httpsAgent,
        proxy: axiosInstance.defaults.proxy
      };
      const existingFile = await axios.request(getConfig);
      existingSha = existingFile.data.sha;
      console.log('✅ README exists, will update it');
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('📄 README does not exist, will create new file');
      }
    }
    
    const data = JSON.stringify({
      message: 'docs: add README',
      content: b64,
      ...(existingSha && { sha: existingSha })
    });
    
    const config = {
      method: 'put',
      url: `https://api.github.com/repos/${owner}/${repo}/contents/README.md`,
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy,
      data: data
    };
    
    console.log('📤 Uploading README to GitHub...');
    await axios.request(config);

    console.log('✅ README updated successfully!');

    // Push media folder if provided
    // if (mediaFolderPath) {
    //   try {
    //     console.log(`📁 Pushing media folder with proxy...`);
    //     await pushDirectoryToGitHub({ 
    //       owner, 
    //       repo, 
    //       localPath: mediaFolderPath, 
    //       repoPath: mediaRepoPath, 
    //       token: authToken,
    //       proxyUrl,
    //       sessionId
    //     });
    //     console.log('✅ Media folder pushed successfully');
    //   } catch (err) {
    //     console.warn('⚠️ Failed to push media folder:', err.message);
    //   }
    // }

    console.log('==============================\n');
    
    // Add 6-second delay after GitHub API call
    console.log('⏳ Waiting 6 seconds after README update...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
  } catch (error) {
    console.error('\n❌ ===== README UPDATE FAILED =====');
    console.error('Error:', error.response?.data?.message || error.message);
    console.error('===================================\n');
    throw new Error(`Failed to update README: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Add topics (tags) to a repository
 * @param {object} options - Topics options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Array<string>} options.topics - Array of topics
 * @param {string} options.token - GitHub token
 * @param {string} options.proxyUrl - Optional proxy URL
 * @param {string} options.sessionId - Optional session ID for sticky IP
 */
async function addTopics({ owner, repo, topics, token, proxyUrl = null, sessionId = null }) {
  console.log('\n🏷️ ===== ADDING TOPICS =====');
  console.log('👤 Owner:', owner);
  console.log('📦 Repo:', repo);
  console.log('🏷️ Topics:', topics);
  console.log('🏷️ Topics type:', typeof topics);
  console.log('🏷️ Topics is array:', Array.isArray(topics));
  if (proxyUrl) {
    console.log('🔌 Using proxy with session:', sessionId?.substring(0, 12) + '...');
  }
  
  // Validate topics parameter
  if (!topics || !Array.isArray(topics)) {
    console.error('❌ Topics parameter is invalid (not an array)');
    console.error('   Received:', topics);
    console.log('============================\n');
    return;
  }
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    console.log('🔧 Topics received (before sanitization):', topics);
    console.log('🔧 Topics type:', typeof topics);
    console.log('🔧 Is array?:', Array.isArray(topics));
    console.log('🔧 Sanitizing topics...');
    const sanitizedTopics = topics
      .map(topic => 
        topic.toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
      )
      .filter(topic => topic.length > 0 && topic.length <= 50)
      .slice(0, 20);

    console.log('✅ Sanitized topics:', sanitizedTopics);
    
    if (sanitizedTopics.length === 0) {
      console.log('⚠️ No valid topics to add');
      console.log('============================\n');
      return;
    }
    
    const data = JSON.stringify({
      names: sanitizedTopics
    });
    
    const config = {
      method: 'put',
      url: `https://api.github.com/repos/${owner}/${repo}/topics`,
      headers: { 
        'Accept': 'application/vnd.github.mercy-preview+json',
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy,
      data: data
    };
    
    console.log('📤 Sending topics to GitHub...');
    await axios.request(config);
    
    console.log('✅ Topics added successfully!');
    console.log('============================\n');
    
    // Add 6-second delay after GitHub API call
    console.log('⏳ Waiting 6 seconds after adding topics...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
  } catch (error) {
    console.error('\n❌ ===== TOPICS ADD FAILED =====');
    console.error('Error:', error.response?.data?.message || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('Full error:', error.stack);
    console.error('================================\n');
    console.warn('⚠️ Continuing without topics...\n');
    // Don't throw - continue campaign even if topics fail
  }
}

/**
 * Create issues in a repository
 */
async function createIssues({ owner, repo, issues, token, proxyUrl = null, sessionId = null }) {
  console.log('\n🐛 ===== CREATING ISSUES =====');
  console.log('👤 Owner:', owner);
  console.log('📦 Repo:', repo);
  console.log('📋 Number of issues:', issues.length);
  if (proxyUrl) {
    console.log('🔌 Using proxy with session:', sessionId?.substring(0, 12) + '...');
  }
  
  const authToken = token || getDefaultGitHubToken();
  const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
  const results = [];
  const errors = [];
  
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    console.log(`\n📝 Creating issue ${i + 1}/${issues.length}:`);
    console.log('  Title:', issue.title);
    
    try {
      const data = JSON.stringify({
        title: issue.title,
        body: issue.body || '',
        labels: issue.labels || []
      });
      
      const config = {
        method: 'post',
        url: `https://api.github.com/repos/${owner}/${repo}/issues`,
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          ...axiosInstance.defaults.headers
        },
        httpsAgent: axiosInstance.defaults.httpsAgent,
        proxy: axiosInstance.defaults.proxy,
        data: data
      };
      
      console.log('  📤 Sending to GitHub...');
      const response = await axios.request(config);
      console.log('  ✅ Issue created successfully');
      
      results.push({ success: true, issue: response.data });
      
      if (i < issues.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.error('  ❌ Failed to create issue');
      errors.push(`Issue "${issue.title}": ${error.response?.data?.message || error.message}`);
      results.push({ success: false, error: error.message });
    }
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Some issues failed to create:');
    errors.forEach(err => console.error('  -', err));
  } else {
    console.log('\n✅ All issues created successfully!');
  }
  
  console.log('==============================\n');
  return results;
}

/**
 * Get repository count for authenticated user
 */
async function getRepoCount(token, proxyUrl = null, sessionId = null) {
  console.log('\n📊 ===== FETCHING REPO COUNT =====');
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    const config = {
      method: 'get',
      url: 'https://api.github.com/user',
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy
    };
    
    const response = await axios.request(config);
    const repoCount = response.data.public_repos + (response.data.total_private_repos || 0);
    
    console.log('✅ Repo count fetched:', repoCount);
    console.log('==================================\n');
    
    return repoCount;
    
  } catch (error) {
    console.error('❌ Failed to fetch repo count:', error.response?.data?.message || error.message);
    throw new Error(`Failed to fetch repo count: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Delete a repository
 */
async function deleteRepository({ owner, repo, token, proxyUrl = null, sessionId = null }) {
  console.log('\n🗑️ ===== DELETING REPOSITORY =====');
  console.log('⚠️ WARNING: This action cannot be undone!');
  console.log('👤 Owner:', owner);
  console.log('📦 Repo:', repo);
  
  try {
    const authToken = token || getDefaultGitHubToken();
    const axiosInstance = createAxiosWithProxy(proxyUrl, sessionId);
    
    const config = {
      method: 'delete',
      url: `https://api.github.com/repos/${owner}/${repo}`,
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        ...axiosInstance.defaults.headers
      },
      httpsAgent: axiosInstance.defaults.httpsAgent,
      proxy: axiosInstance.defaults.proxy
    };
    
    console.log('📤 Sending delete request...');
    await axios.request(config);
    
    console.log('✅ Repository deleted successfully!');
    console.log('==================================\n');
    
  } catch (error) {
    console.error('❌ Failed to delete repository');
    console.error('Error:', error.response?.data?.message || error.message);
    console.error('==================================\n');
    throw new Error(`Failed to delete repository: ${error.response?.data?.message || error.message}`);
  }
}

export {
  createRepository,
  updateReadme,
  addTopics,
  createIssues,
  verifyToken,
  getRepoCount,
  deleteRepository,
  getDefaultGitHubToken,
  createAxiosWithProxy
};