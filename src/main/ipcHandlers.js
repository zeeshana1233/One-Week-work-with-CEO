import { ipcMain, app } from 'electron';
import { campaignManager } from '../services/campaignManager.js';
import { storage } from '../services/storage.js';
import { starsCampaignManager } from '../services/Starscampaignmanager.js';
import { indexerCampaignManager } from '../services/indexerCampaignManager.js';
import { upworkCampaignManager } from '../services/upworkCampaignManager.js';

//console.log('🔧 Registering IPC handlers...');

// App info
ipcMain.handle('app:get-info', async () => {
  //console.log('ℹ️ Getting app info');
  return {
    name: app.getName(),
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
  };
});

// ==================== Campaign Operations ====================
ipcMain.handle('campaigns:list', async () => {
  try {
    //console.log('📋 Listing campaigns');
    const campaigns = await storage.getCampaigns();
    //console.log(`✅ Found ${campaigns.length} campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing campaigns:', error);
    throw error;
  }
});

ipcMain.handle('campaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: campaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ Campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('⏱️ Time Coefficient:', campaign.timeCoefficient || 'balanced');
    //console.log('⏱️ Repos Per Hour:', campaign.reposPerHour || 30);
    //console.log('⏱️ Delay Between Repos:', campaign.delayBetweenRepos || 2000, 'ms');
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ Error creating campaign in IPC handler');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('='.repeat(50) + '\n');
    throw error;
  }
});

ipcMain.handle('campaigns:update', async (_event, id, updates) => {
  try {
    //console.log('📝 Updating campaign:', id, updates);
    const campaign = await storage.updateCampaign(id, updates);
    //console.log('✅ Campaign updated');
    return campaign;
  } catch (error) {
    console.error('❌ Error updating campaign:', error);
    throw error;
  }
});

ipcMain.handle('campaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting campaign:', id);
    await storage.deleteCampaign(id);
    //console.log('✅ Campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting campaign:', error);
    throw error;
  }
});

ipcMain.handle('campaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting campaign:', id);
    await campaignManager.startCampaign(id);
    //console.log('✅ Campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting campaign:', error);
    throw error;
  }
});

ipcMain.handle('campaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏹️ Stopping campaign:', id);
    await campaignManager.stopCampaign(id);
    //console.log('✅ Campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping campaign:', error);
    throw error;
  }
});

// ==================== Account Groups Operations ====================
ipcMain.handle('accountGroups:list', async () => {
  try {
    //console.log('📋 Listing account groups');
    const groups = await storage.getAccountGroups();
    //console.log(`✅ Found ${groups.length} account groups`);
    return groups;
  } catch (error) {
    console.error('❌ Error listing account groups:', error);
    throw error;
  }
});

ipcMain.handle('accountGroups:create', async (_event, data) => {
  try {
    //console.log('➕ Creating account group:', data.name);
    const group = await storage.createAccountGroup(data);
    //console.log('✅ Account group created:', group.id);
    return group;
  } catch (error) {
    console.error('❌ Error creating account group:', error);
    throw error;
  }
});

ipcMain.handle('accountGroups:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting account group:', id);
    await storage.deleteAccountGroup(id);
    //console.log('✅ Account group deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting account group:', error);
    throw error;
  }
});

// ==================== GitHub Accounts Operations ====================
ipcMain.handle('githubAccounts:list', async (_event, groupId) => {
  try {
    //console.log('📋 Listing GitHub accounts for group:', groupId);
    const accounts = await storage.getGithubAccounts(groupId);
    //console.log(`✅ Found ${accounts.length} GitHub accounts`);
    return accounts;
  } catch (error) {
    console.error('❌ Error listing GitHub accounts:', error);
    throw error;
  }
});

ipcMain.handle('githubAccounts:create', async (_event, data) => {
  try {
    //console.log('➕ Creating GitHub account:', data.username);
    const account = await storage.createGithubAccount(data);
    //console.log('✅ GitHub account created:', account.id);
    return account;
  } catch (error) {
    console.error('❌ Error creating GitHub account:', error);
    throw error;
  }
});

ipcMain.handle('githubAccounts:update', async (_event, id, updates) => {
  try {
    //console.log('📝 Updating GitHub account:', id);
    const account = await storage.updateGithubAccount(id, updates);
    //console.log('✅ GitHub account updated');
    return account;
  } catch (error) {
    console.error('❌ Error updating GitHub account:', error);
    throw error;
  }
});

ipcMain.handle('githubAccounts:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting GitHub account:', id);
    await storage.deleteGithubAccount(id);
    //console.log('✅ GitHub account deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting GitHub account:', error);
    throw error;
  }
});

// ==================== Logs ====================
ipcMain.handle('logs:get', async (_event, { id, since = 0 }) => {
  try {
    //console.log('📜 Getting logs for campaign:', id);
    const logs = await storage.getLogs(id, since);
    //console.log(`✅ Found ${logs.length} logs`);
    return logs;
  } catch (error) {
    console.error('❌ Error getting logs:', error);
    throw error;
  }
});

ipcMain.handle('logs:clear', async (_event, { id }) => {
  try {
    //console.log('🧹 Clearing logs for campaign:', id);
    await storage.clearLogs(id);
    //console.log('✅ Logs cleared');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error clearing logs:', error);
    throw error;
  }
});
// Add this after the existing handlers, before the final console.log

// ==================== GitHub Repository Operations ====================
ipcMain.handle('github:deleteRepo', async (_event, { owner, repo, accountId }) => {
  try {
    //console.log('🗑️ Deleting GitHub repository:', repo);
    //console.log('  Owner:', owner);
    //console.log('  Account ID:', accountId);
    
    // Get the account token
    const token = await storage.getGithubAccountToken(accountId);
    
    // Import deleteRepository from githubService
    const { deleteRepository } = await import('../services/githubService.js');
    
    // Delete the repository
    await deleteRepository({ owner, repo, token });
    
    //console.log('✅ Repository deleted successfully');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting repository:', error);
    throw error;
  }
});

// Add this near the end, before the final console.log

// ==================== Shell Operations ====================
ipcMain.handle('shell:openExternal', async (_event, url) => {
  try {
    //console.log('🌐 Opening URL in browser:', url);
    const { shell } = await import('electron');
    await shell.openExternal(url);
    //console.log('✅ URL opened successfully');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error opening URL:', error);
    throw error;
  }
});
ipcMain.handle('starsCampaigns:list', async () => {
  try {
    //console.log('📋 Listing stars campaigns');
    const campaigns = await storage.getStarsCampaigns();
    //console.log(`✅ Found ${campaigns.length} stars campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing stars campaigns:', error);
    throw error;
  }
});

// Create a new stars campaign
ipcMain.handle('starsCampaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: starsCampaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createStarsCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ Stars campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('🔍 Keyword:', campaign.keyword);
    //console.log('🔗 Target URL:', campaign.targetUrl);
    //console.log('📁 Folder ID:', campaign.folderId);
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ Error creating stars campaign in IPC handler');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('='.repeat(50) + '\n');
    throw error;
  }
});

// Start a stars campaign
ipcMain.handle('starsCampaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting stars campaign:', id);
    await starsCampaignManager.startCampaign(id);
    //console.log('✅ Stars campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting stars campaign:', error);
    throw error;
  }
});

// Stop a stars campaign
ipcMain.handle('starsCampaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏹️ Stopping stars campaign:', id);
    await starsCampaignManager.stopCampaign(id);
    //console.log('✅ Stars campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping stars campaign:', error);
    throw error;
  }
});

// Delete a stars campaign
ipcMain.handle('starsCampaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting stars campaign:', id);
    await storage.deleteStarsCampaign(id);
    //console.log('✅ Stars campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting stars campaign:', error);
    throw error;
  }
});

// Get GoLogin folders
ipcMain.handle('gologin:getFolders', async () => {
  try {
    //console.log('📁 Fetching GoLogin folders');
    
    const GOLOGIN_TOKEN = process.env.GOLOGIN_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NjdkZjY2MDAwMjUxYmVhZTBlNzE4NTMiLCJ0eXBlIjoiZGV2Iiwiand0aWQiOiI2OTAxZWFkMWQ5ZDQwMGQwNWVhNTRlOGYifQ.V1bHwt59yXUbP8wODHM_K0Pa2Ipf0wv8l06cP8zthmc';
    
    const response = await fetch('https://api.gologin.com/folders', {
      headers: {
        'Authorization': `Bearer ${GOLOGIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const folders = await response.json();
    //console.log(`✅ Found ${folders.length} GoLogin folders`);
    
    // Fetch profile counts for each folder
    const foldersWithCounts = await Promise.all(
      folders.map(async (folder) => {
        try {
          const profilesResponse = await fetch(
            `https://api.gologin.com/browser/v2?folder=${encodeURIComponent(folder.name)}`,
            {
              headers: {
                'Authorization': `Bearer ${GOLOGIN_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (profilesResponse.ok) {
            const data = await profilesResponse.json();
            return {
              ...folder,
              profileCount: data.profiles?.length || 0
            };
          }
          
          return { ...folder, profileCount: 0 };
        } catch (err) {
          console.error(`Error fetching profiles for folder ${folder.name}:`, err);
          return { ...folder, profileCount: 0 };
        }
      })
    );
    
    return foldersWithCounts;
  } catch (error) {
    console.error('❌ Error fetching GoLogin folders:', error);
    throw error;
  }
});

// ==================== Indexer Campaign Operations ====================
// List indexer campaigns
ipcMain.handle('indexerCampaigns:list', async () => {
  try {
    //console.log('📋 Listing indexer campaigns');
    const campaigns = await storage.getIndexerCampaigns();
    //console.log(`✅ Found ${campaigns.length} indexer campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing indexer campaigns:', error);
    throw error;
  }
});

// Create indexer campaign
ipcMain.handle('indexerCampaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: indexerCampaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createIndexerCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ Indexer campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('🔍 Search Type:', campaign.searchType);
    //console.log('🔗 Repository URL:', campaign.repoUrl);
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ Error creating indexer campaign in IPC handler');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('='.repeat(50) + '\n');
    throw error;
  }
});

// Start indexer campaign
ipcMain.handle('indexerCampaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting indexer campaign:', id);
    await indexerCampaignManager.startCampaign(id);
    //console.log('✅ Indexer campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting indexer campaign:', error);
    throw error;
  }
});

// Stop indexer campaign
ipcMain.handle('indexerCampaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏹️ Stopping indexer campaign:', id);
    await indexerCampaignManager.stopCampaign(id);
    //console.log('✅ Indexer campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping indexer campaign:', error);
    throw error;
  }
});

// Delete indexer campaign
ipcMain.handle('indexerCampaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting indexer campaign:', id);
    await storage.deleteIndexerCampaign(id);
    //console.log('✅ Indexer campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting indexer campaign:', error);
    throw error;
  }
});

// ==================== GPT Accounts Operations ====================
// List GPT accounts
ipcMain.handle('gptAccounts:list', async () => {
  try {
    //console.log('📋 Listing GPT accounts');
    const accounts = await storage.getGPTAccounts();
    return accounts;
  } catch (error) {
    console.error('❌ Error listing GPT accounts:', error);
    throw error;
  }
});

// Create GPT account
ipcMain.handle('gptAccounts:create', async (_event, payload) => {
  try {
    //console.log('📝 Creating GPT account:', payload.name);
    const account = await storage.createGPTAccount(payload);
    return account;
  } catch (error) {
    console.error('❌ Error creating GPT account:', error);
    throw error;
  }
});

// Update GPT account
ipcMain.handle('gptAccounts:update', async (_event, id, updates) => {
  try {
    //console.log('📝 Updating GPT account:', id);
    await storage.updateGPTAccount(id, updates);
    return true;
  } catch (error) {
    console.error('❌ Error updating GPT account:', error);
    throw error;
  }
});

// Delete GPT account
ipcMain.handle('gptAccounts:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting GPT account:', id);
    await storage.deleteGPTAccount(id);
    return true;
  } catch (error) {
    console.error('❌ Error deleting GPT account:', error);
    throw error;
  }
});


// ==================== View Campaign Operations ====================
// List view campaigns
ipcMain.handle('viewCampaigns:list', async () => {
  try {
    //console.log('📋 Listing view campaigns');
    const campaigns = await storage.getViewCampaigns();
    //console.log(`✅ Found ${campaigns.length} view campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing view campaigns:', error);
    throw error;
  }
});

// Create view campaign
ipcMain.handle('viewCampaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: viewCampaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createViewCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ View campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('🔍 Search Type:', campaign.searchType);
    //console.log('🔍 Search Query:', campaign.searchQuery);
    //console.log('🔗 Repo URL:', campaign.repoUrl);
    //console.log('👁️ Number of Views:', campaign.numViews);
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('❌ Error creating view campaign in IPC handler');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('='.repeat(50) + '\n');
    throw error;
  }
});

// Start view campaign
ipcMain.handle('viewCampaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting view campaign:', id);
    // We'll implement the view campaign manager next
    const { viewCampaignManager } = await import('../services/viewCampaignManager.js');
    await viewCampaignManager.startCampaign(id);
    //console.log('✅ View campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting view campaign:', error);
    throw error;
  }
});

// Stop view campaign
ipcMain.handle('viewCampaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏹️ Stopping view campaign:', id);
    const { viewCampaignManager } = await import('../services/viewCampaignManager.js');
    await viewCampaignManager.stopCampaign(id);
    //console.log('✅ View campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping view campaign:', error);
    throw error;
  }
});

// Delete view campaign
ipcMain.handle('viewCampaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting view campaign:', id);
    await storage.deleteViewCampaign(id);
    //console.log('✅ View campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting view campaign:', error);
    throw error;
  }
});


// ==================== Upwork Campaign Operations ====================
ipcMain.handle('upworkCampaigns:list', async () => {
  try {
    //console.log('📋 Listing Upwork campaigns');
    const campaigns = await storage.getUpworkCampaigns();
    //console.log(`✅ Found ${campaigns.length} Upwork campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing Upwork campaigns:', error);
    throw error;
  }
});

ipcMain.handle('upworkCampaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: upworkCampaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createUpworkCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ Upwork campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('🔍 Search Input:', campaign.upworkSearchInput);
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('❌ Error creating Upwork campaign:', error);
    throw error;
  }
});

ipcMain.handle('upworkCampaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting Upwork campaign:', id);
    
    // Start in background
    upworkCampaignManager.startCampaign(id).catch(error => {
      console.error('❌ Upwork campaign error:', error);
    });
    
    //console.log('✅ Upwork campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting Upwork campaign:', error);
    throw error;
  }
});

ipcMain.handle('upworkCampaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏸️ Stopping Upwork campaign:', id);
    await upworkCampaignManager.stopCampaign(id);
    //console.log('✅ Upwork campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping Upwork campaign:', error);
    throw error;
  }
});

// Delete Upwork campaign
ipcMain.handle('upworkCampaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting Upwork campaign:', id);
    await storage.deleteUpworkCampaign(id);
    //console.log('✅ Upwork campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting Upwork campaign:', error);
    throw error;
  }
});
ipcMain.handle('proxyBulks:list', async () => {
  try {
    //console.log('📋 Listing proxy bulks');
    const bulks = await storage.getProxyBulks();
    //console.log(`✅ Found ${bulks.length} proxy bulks`);
    return bulks;
  } catch (error) {
    console.error('❌ Error listing proxy bulks:', error);
    throw error;
  }
});

ipcMain.handle('proxyBulks:create', async (_event, data) => {
  try {
    //console.log('➕ Creating proxy bulk:', data.name);
    const bulk = await storage.createProxyBulk(data);
    //console.log('✅ Proxy bulk created:', bulk.id);
    return bulk;
  } catch (error) {
    console.error('❌ Error creating proxy bulk:', error);
    throw error;
  }
});

ipcMain.handle('proxyBulks:update', async (_event, id, updates) => {
  try {
    //console.log('📝 Updating proxy bulk:', id);
    const bulk = await storage.updateProxyBulk(id, updates);
    //console.log('✅ Proxy bulk updated');
    return bulk;
  } catch (error) {
    console.error('❌ Error updating proxy bulk:', error);
    throw error;
  }
});

ipcMain.handle('proxyBulks:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting proxy bulk:', id);
    await storage.deleteProxyBulk(id);
    //console.log('✅ Proxy bulk deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting proxy bulk:', error);
    throw error;
  }
});
ipcMain.handle('scrapeJobsCampaigns:list', async () => {
  try {
    //console.log('📋 Listing scrape-jobs campaigns');
    const campaigns = await storage.getScrapeJobsCampaigns();
    //console.log(`✅ Found ${campaigns.length} scrape-jobs campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error listing scrape-jobs campaigns:', error);
    throw error;
  }
});

ipcMain.handle('scrapeJobsCampaigns:create', async (_event, payload) => {
  try {
    //console.log('\n' + '='.repeat(50));
    //console.log('➕ IPC Handler: scrapeJobsCampaigns:create called');
    //console.log('📦 Payload received:', JSON.stringify(payload, null, 2));
    //console.log('='.repeat(50));
    
    const campaign = await storage.createScrapeJobsCampaign(payload);
    
    //console.log('\n' + '='.repeat(50));
    //console.log('✅ Scrape-jobs campaign created successfully!');
    //console.log('📝 Campaign ID:', campaign.id);
    //console.log('📝 Campaign Name:', campaign.name);
    //console.log('🔗 Job URLs:', campaign.scrapeJobUrls.length);
    //console.log('='.repeat(50) + '\n');
    
    return campaign;
  } catch (error) {
    console.error('❌ Error creating scrape-jobs campaign:', error);
    throw error;
  }
});

ipcMain.handle('scrapeJobsCampaigns:start', async (_event, { id }) => {
  try {
    //console.log('▶️ Starting scrape-jobs campaign:', id);
    
    // Import the upwork campaign manager
    const { upworkCampaignManager } = await import('../services/upworkCampaignManager.js');
    
    // Start in background
    upworkCampaignManager.startScrapeJobsCampaign(id).catch(error => {
      console.error('❌ Scrape-jobs campaign error:', error);
    });
    
    //console.log('✅ Scrape-jobs campaign started');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error starting scrape-jobs campaign:', error);
    throw error;
  }
});

ipcMain.handle('scrapeJobsCampaigns:stop', async (_event, { id }) => {
  try {
    //console.log('⏸️ Stopping scrape-jobs campaign:', id);
    const { upworkCampaignManager } = await import('../services/upworkCampaignManager.js');
    await upworkCampaignManager.stopCampaign(id);
    //console.log('✅ Scrape-jobs campaign stopped');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error stopping scrape-jobs campaign:', error);
    throw error;
  }
});

ipcMain.handle('scrapeJobsCampaigns:delete', async (_event, id) => {
  try {
    //console.log('🗑️ Deleting scrape-jobs campaign:', id);
    await storage.deleteScrapeJobsCampaign(id);
    //console.log('✅ Scrape-jobs campaign deleted');
    return { ok: true };
  } catch (error) {
    console.error('❌ Error deleting scrape-jobs campaign:', error);
    throw error;
  }
});


//console.log('✅ All IPC handlers registered');