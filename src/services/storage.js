import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';

class Storage {
  constructor() {
    this.client = null;
    this.db = null;
    this.campaigns = null;
    this.starsCampaigns = null;
    this.indexerCampaigns = null;
    this.viewCampaigns = null;
    this.upworkCampaigns = null;
    this.logs = null;
    this.accountGroups = null;
    this.githubAccounts = null;
    this.gptAccounts = null;
    this.proxyBulks = null;  // NEW: Add proxyBulks collection
    this.processedJobs = null; // Collection to store processed Upwork jobs (dedupe)
    this.dataToExport = null; // Collection to store job data before repo creation
    this.connected = false;
  }

  async connect() {
    if (this.connected) {
      //console.log('✅ Already connected to MongoDB');
      return;
    }

    try {
      //console.log('\n🔌 ===== CONNECTING TO MONGODB ATLAS =====');
      const uri = "mongodb+srv://jaishasohail419_db_user:FnLrrjb3iYhiqfIN@cluster0.kjhwa8e.mongodb.net/?appName=Cluster0";
      
      if (!uri) {
        throw new Error('MONGODB_URI environment variable is not set');
      }
      
      // Don't log the full URI for security (it contains password)
      const sanitizedUri = uri.replace(/:([^:@]+)@/, ':****@');
      //console.log('🔗 MongoDB URI:', sanitizedUri);
      
      this.client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      });
      
      await this.client.connect();
      
      // Verify connection
      await this.client.db('admin').command({ ping: 1 });
      
      const dbName = 'github_automation_UTP2';
      //console.log('💾 Database:', dbName);
      
      this.db = this.client.db(dbName);
      this.campaigns = this.db.collection('campaigns');
      this.starsCampaigns = this.db.collection('starsCampaigns');
      this.indexerCampaigns = this.db.collection('indexerCampaigns');
      this.viewCampaigns = this.db.collection('viewCampaigns');
      this.upworkCampaigns = this.db.collection('upworkCampaigns');
      this.logs = this.db.collection('logs');
      this.accountGroups = this.db.collection('accountGroups');
      this.githubAccounts = this.db.collection('githubAccounts');
      this.gptAccounts = this.db.collection('gptAccounts');
      this.proxyBulks = this.db.collection('proxyBulks');  // NEW: Initialize proxyBulks
      this.processedJobs = this.db.collection('processedJobs'); // Initialize processed jobs collection
      this.dataToExport = this.db.collection('dataToExport'); // Initialize data_to_export collection
      
      // Create indexes for better performance
      await this.campaigns.createIndex({ id: 1 }, { unique: true });
      await this.starsCampaigns.createIndex({ id: 1 }, { unique: true });
      await this.indexerCampaigns.createIndex({ id: 1 }, { unique: true });
      await this.viewCampaigns.createIndex({ id: 1 }, { unique: true });
      await this.upworkCampaigns.createIndex({ id: 1 }, { unique: true });
      await this.logs.createIndex({ campaignId: 1, timestamp: -1 });
      await this.accountGroups.createIndex({ id: 1 }, { unique: true });
      await this.githubAccounts.createIndex({ id: 1 }, { unique: true });
      await this.githubAccounts.createIndex({ groupId: 1 });
      await this.gptAccounts.createIndex({ id: 1 }, { unique: true });
      await this.proxyBulks.createIndex({ id: 1 }, { unique: true });  // NEW: Index for proxyBulks
      // Indexes for processed jobs to support duplicate detection and queries
      await this.processedJobs.createIndex({ id: 1 }, { unique: true, sparse: true });
      await this.processedJobs.createIndex({ normalizedTitle: 1 });
      await this.processedJobs.createIndex({ campaignId: 1 });
      await this.processedJobs.createIndex({ createdAt: -1 });
      // Indexes for data_to_export collection
      await this.dataToExport.createIndex({ id: 1 }, { unique: true });
      await this.dataToExport.createIndex({ campaignId: 1 });
      await this.dataToExport.createIndex({ createdAt: -1 });
      
      this.connected = true;
      //console.log('✅ Connected to MongoDB Atlas successfully');
      //console.log('=========================================\n');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB Atlas:', error.message);
      if (error.message.includes('MONGODB_URI')) {
        console.error('💡 Tip: Make sure MONGODB_URI is set in your .env file');
      } else if (error.message.includes('authentication failed')) {
        console.error('💡 Tip: Check your username and password in the connection string');
      } else if (error.message.includes('connection')) {
        console.error('💡 Tip: Check your network access settings in MongoDB Atlas');
      }
      throw error;
    }
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  // ==================== Campaign Operations ====================
  async getCampaigns() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching campaigns from MongoDB...');
      const campaigns = await this.campaigns.find({}).toArray();
      //console.log(`✅ Found ${campaigns.length} campaigns`);
      return campaigns;
    } catch (error) {
      console.error('❌ Error fetching campaigns:', error);
      throw error;
    }
  }

  async getCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching campaign:', id);
      const campaign = await this.campaigns.findOne({ id });
      
      if (!campaign) {
        //console.log('⚠️ Campaign not found:', id);
        return null;
      }
      
      //console.log('✅ Campaign found');
      return campaign;
    } catch (error) {
      console.error('❌ Error fetching campaign:', error);
      throw error;
    }
  }

  async createCampaign(campaignData) {
    await this.ensureConnected();
    
    try {
      // Calculate total items based on category
      let totalItems = 0;
      if (campaignData.category === 'apify') {
        totalItems = campaignData.apifyUrls?.split('\n').filter(l => l.trim()).length || 0;
      } else if (campaignData.category === 'va') {
        if (campaignData.vaRepoType === 'single') {
          totalItems = 1;
        } else {
          totalItems = campaignData.vaMultipleRepoDescriptions?.split('\n').filter(l => l.trim()).length || 0;
        }
      } else {
        totalItems = campaignData.keywords?.split('\n').filter(l => l.trim()).length || 0;
      }
      
      const campaign = {
        id: uuidv4(),
        name: campaignData.name,
        category: campaignData.category || 'keywords', // 'keywords', 'apify', or 'va'
        accountGroupId: campaignData.accountGroupId,
        gptAccountId: campaignData.gptAccountId,
        
        // Keywords/Questions fields

        keywords: campaignData.keywords || '',
        questions: campaignData.questions || '',
        
        // Apify fields
        apifyUrls: campaignData.apifyUrls || '',
        
        // VA Campaign fields
        vaRepoType: campaignData.vaRepoType,
        vaPlatform: campaignData.vaPlatform || 'bitbash',
        vaSingleRepoDescriptions: campaignData.vaSingleRepoDescriptions || '',
        vaMultipleRepoDescriptions: campaignData.vaMultipleRepoDescriptions || '',
        
        // Time coefficient settings
        timeCoefficient: campaignData.timeCoefficient || 'balanced',
        delayBetweenRepos: campaignData.delayBetweenRepos || 900000,
        reposPerHour: campaignData.reposPerHour || 4,
        
        status: 'Idle',
        progress: { 
          processed: 0, 
          total: totalItems
        },
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      //console.log('💾 Creating campaign in MongoDB:', campaign.id);
      //console.log('  Name:', campaign.name);
      //console.log('  Category:', campaign.category);
      //console.log('  Account Group:', campaign.accountGroupId);
      //console.log('🔍 DEBUG: Type of accountGroupId:', typeof campaign.accountGroupId);
      //console.log('  GPT Account:', campaign.gptAccountId);
      //console.log('  Total items:', campaign.progress.total);
      
      if (campaign.category === 'va') {
        //console.log('  VA Repo Type:', campaign.vaRepoType);
        //console.log('  VA Platform:', campaign.vaPlatform);
      }
      
      const result = await this.campaigns.insertOne(campaign);
      
      if (!result.acknowledged) {
        throw new Error('Failed to insert campaign into database');
      }
      
      //console.log('✅ Campaign created successfully');
      return campaign;
    } catch (error) {
      console.error('❌ Error creating campaign:', error);
      throw error;
    }
  }

  async updateCampaign(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('📝 Updating campaign:', id);
      //console.log('  Updates:', Object.keys(updates));
      
      // Add updatedAt timestamp
      updates.updatedAt = new Date().toISOString();
      
      const result = await this.campaigns.findOneAndUpdate(
        { id },
        { $set: updates },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        throw new Error(`Campaign ${id} not found`);
      }
      
      //console.log('✅ Campaign updated successfully');
      return result;
    } catch (error) {
      console.error('❌ Error updating campaign:', error);
      throw error;
    }
  }

  async deleteCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting campaign:', id);
      
      // Delete campaign
      const campaignResult = await this.campaigns.deleteOne({ id });
      
      if (campaignResult.deletedCount === 0) {
        throw new Error(`Campaign ${id} not found`);
      }
      
      // Delete associated logs
      const logsResult = await this.logs.deleteMany({ campaignId: id });
      //console.log(`🗑️ Deleted ${logsResult.deletedCount} logs`);
      
      //console.log('✅ Campaign deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ Error deleting campaign:', error);
      throw error;
    }
  }

  // ==================== Stars Campaign Operations ====================
  async getStarsCampaigns() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching stars campaigns from MongoDB...');
      const campaigns = await this.starsCampaigns.find({}).toArray();
      //console.log(`✅ Found ${campaigns.length} stars campaigns`);
      return campaigns;
    } catch (error) {
      console.error('❌ Error fetching stars campaigns:', error);
      throw error;
    }
  }

  async getStarsCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching stars campaign:', id);
      const campaign = await this.starsCampaigns.findOne({ id });
      
      if (!campaign) {
        //console.log('⚠️ Stars campaign not found:', id);
        return null;
      }
      
      //console.log('✅ Stars campaign found');
      return campaign;
    } catch (error) {
      console.error('❌ Error fetching stars campaign:', error);
      throw error;
    }
  }

  async createStarsCampaign(campaignData) {
    await this.ensureConnected();
    
    try {
      const campaign = {
        id: uuidv4(),
        name: campaignData.name,
        keyword: campaignData.keyword,
        targetUrl: campaignData.targetUrl,
        folderId: campaignData.folderId,
        folderName: campaignData.folderName || 'Unknown',
        status: 'Idle',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        stoppedAt: null,
        progress: 0,
        currentProfile: 0,
        totalProfiles: 0,
        stats: {
          successful: 0,
          skipped: 0,
          failed: 0
        }
      };
      
      //console.log('💾 Creating stars campaign in MongoDB:', campaign.id);
      //console.log('  Name:', campaign.name);
      //console.log('  Keyword:', campaign.keyword);
      //console.log('  Target URL:', campaign.targetUrl);
      //console.log('  Folder:', campaign.folderName);
      
      const result = await this.starsCampaigns.insertOne(campaign);
      
      if (!result.acknowledged) {
        throw new Error('Failed to insert stars campaign into database');
      }
      
      //console.log('✅ Stars campaign created successfully');
      return campaign;
    } catch (error) {
      console.error('❌ Error creating stars campaign:', error);
      throw error;
    }
  }

  async updateStarsCampaign(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('📝 Updating stars campaign:', id);
      //console.log('  Updates:', Object.keys(updates));
      
      // Add updatedAt timestamp
      updates.updatedAt = new Date().toISOString();
      
      const result = await this.starsCampaigns.findOneAndUpdate(
        { id },
        { $set: updates },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        throw new Error(`Stars campaign ${id} not found`);
      }
      
      //console.log('✅ Stars campaign updated successfully');
      return result;
    } catch (error) {
      console.error('❌ Error updating stars campaign:', error);
      throw error;
    }
  }

  async deleteStarsCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting stars campaign:', id);
      
      // Delete campaign
      const campaignResult = await this.starsCampaigns.deleteOne({ id });
      
      if (campaignResult.deletedCount === 0) {
        throw new Error(`Stars campaign ${id} not found`);
      }
      
      // Delete associated logs
      const logsResult = await this.logs.deleteMany({ campaignId: id });
      //console.log(`🗑️ Deleted ${logsResult.deletedCount} logs`);
      
      //console.log('✅ Stars campaign deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ Error deleting stars campaign:', error);
      throw error;
    }
  }

  // ==================== Indexer Campaign Operations ====================
  async getIndexerCampaigns() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching indexer campaigns from MongoDB...');
      const campaigns = await this.indexerCampaigns.find({}).sort({ createdAt: -1 }).toArray();
      //console.log(`✅ Found ${campaigns.length} indexer campaigns`);
      return campaigns;
    } catch (error) {
      console.error('❌ Error fetching indexer campaigns:', error);
      throw error;
    }
  }

  async getIndexerCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching indexer campaign:', id);
      const campaign = await this.indexerCampaigns.findOne({ id });
      
      if (!campaign) {
        console.warn('⚠️ Indexer campaign not found:', id);
        return null;
      }
      
      //console.log('✅ Found indexer campaign:', campaign.name);
      return campaign;
    } catch (error) {
      console.error('❌ Error fetching indexer campaign:', error);
      throw error;
    }
  }

  async createIndexerCampaign(campaignData) {
    await this.ensureConnected();
    
    try {
      //console.log('➕ Creating indexer campaign:', campaignData.name);
      
      const campaign = {
        id: nanoid(),
        ...campaignData,
        status: 'Idle',
        results: [], // Array to store results for each item
        progress: {
          processed: 0,
          total: campaignData.items ? campaignData.items.length : 1
        },
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: null,
        completedAt: null
      };
      
      await this.indexerCampaigns.insertOne(campaign);
      
      //console.log('✅ Indexer campaign created successfully');
      //console.log('📝 Campaign ID:', campaign.id);
      //console.log('📝 Campaign Name:', campaign.name);
      //console.log('� Total items:', campaign.progress.total);
      
      return campaign;
    } catch (error) {
      console.error('❌ Error creating indexer campaign:', error);
      throw error;
    }
  }

  async updateIndexerCampaign(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('📝 Updating indexer campaign:', id);
      
      const updateData = {
        ...updates,
        updatedAt: new Date()
      };
      
      const result = await this.indexerCampaigns.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        throw new Error('Indexer campaign not found');
      }
      
      //console.log('✅ Indexer campaign updated');
      return result;
    } catch (error) {
      console.error('❌ Error updating indexer campaign:', error);
      throw error;
    }
  }

  async deleteIndexerCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting indexer campaign:', id);
      
      // Delete campaign
      await this.indexerCampaigns.deleteOne({ id });
      
      // Delete associated logs
      await this.logs.deleteMany({ campaignId: id });
      
      //console.log('✅ Indexer campaign deleted');
      return { ok: true };
    } catch (error) {
      console.error('❌ Error deleting indexer campaign:', error);
      throw error;
    }
  }

  // ==================== Account Groups Operations ====================
  async getAccountGroups() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching account groups from MongoDB...');
      const groups = await this.accountGroups.find({}).toArray();
      
      // Add account count to each group
      const groupsWithCount = await Promise.all(
        groups.map(async (group) => {
          const accountCount = await this.githubAccounts.countDocuments({ groupId: group.id });
          return {
            ...group,
            accountCount
          };
        })
      );
      
      //console.log(`✅ Found ${groups.length} account groups`);
      return groupsWithCount;
    } catch (error) {
      console.error('❌ Error fetching account groups:', error);
      throw error;
    }
  }

  async createAccountGroup(data) {
    await this.ensureConnected();
    
    try {
      const group = {
        id: nanoid(),
        name: data.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      //console.log('💾 Creating account group in MongoDB:', group.id);
      //console.log('  Name:', group.name);
      
      const result = await this.accountGroups.insertOne(group);
      
      if (!result.acknowledged) {
        throw new Error('Failed to insert account group into database');
      }
      
      //console.log('✅ Account group created successfully');
      return {
        ...group,
        accountCount: 0
      };
    } catch (error) {
      console.error('❌ Error creating account group:', error);
      throw error;
    }
  }

  async deleteAccountGroup(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting account group:', id);
      
      // Delete the group
      const groupResult = await this.accountGroups.deleteOne({ id });
      
      if (groupResult.deletedCount === 0) {
        throw new Error(`Account group ${id} not found`);
      }
      
      // Delete all accounts in this group
      const accountsResult = await this.githubAccounts.deleteMany({ groupId: id });
      //console.log(`🗑️ Deleted ${accountsResult.deletedCount} GitHub accounts`);
      
      //console.log('✅ Account group deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ Error deleting account group:', error);
      throw error;
    }
  }

  // ==================== GitHub Account Operations ====================
  async getGithubAccounts(groupId) {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching GitHub accounts for group:', groupId);
      //console.log('🔍 DEBUG: Type of groupId:', typeof groupId);
      //console.log('🔍 DEBUG: Query object:', { groupId });
      
      const accounts = await this.githubAccounts
        .find({ groupId })
        .toArray();
      
      //console.log(`🔍 DEBUG: Raw accounts found: ${accounts.length}`);
      if (accounts.length > 0) {
        console.log('🔍 DEBUG: Sample account:', {
          id: accounts[0].id,
          groupId: accounts[0].groupId,
          username: accounts[0].username
        });
      }
      
      // Return without access tokens for security
      const accountsWithoutTokens = accounts.map(acc => ({
        id: acc.id,
        groupId: acc.groupId,
        username: acc.username,
        status: acc.status || 'pending',
        repoCount: acc.repoCount || 0,
        lastUsed: acc.lastUsed,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt
      }));
      
      //console.log(`✅ Found ${accounts.length} GitHub accounts`);
      return accountsWithoutTokens;
    } catch (error) {
      console.error('❌ Error fetching GitHub accounts:', error);
      throw error;
    }
  }

  // async createGithubAccount(data) {
  //   await this.ensureConnected();
    
  //   try {
  //     const account = {
  //       id: nanoid(),
  //       groupId: data.groupId,
  //       username: data.username,
  //       accessToken: data.accessToken, // Store encrypted in production
  //       status: 'pending',
  //       repoCount: 0,
  //       lastUsed: null,
  //       createdAt: new Date().toISOString(),
  //       updatedAt: new Date().toISOString()
  //     };

  //     console.log('💾 Creating GitHub account in MongoDB:', account.id);
  //     console.log('  Username:', account.username);
  //     console.log('  Group ID:', account.groupId);
      
  //     const result = await this.githubAccounts.insertOne(account);
      
  //     if (!result.acknowledged) {
  //       throw new Error('Failed to insert GitHub account into database');
  //     }
      
  //     console.log('✅ GitHub account created successfully');
      
  //     // Return without access token
  //     const { accessToken, ...accountWithoutToken } = account;
  //     return accountWithoutToken;
  //   } catch (error) {
  //     console.error('❌ Error creating GitHub account:', error);
  //     throw error;
  //   }
  // }

  async updateGithubAccount(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('📝 Updating GitHub account:', id);
      //console.log('  Updates:', Object.keys(updates));
      
      // Add updatedAt timestamp
      updates.updatedAt = new Date().toISOString();
      
      const result = await this.githubAccounts.findOneAndUpdate(
        { id },
        { $set: updates },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        throw new Error(`GitHub account ${id} not found`);
      }
      
      //console.log('✅ GitHub account updated successfully');
      
      // Return without access token
      const { accessToken, ...accountWithoutToken } = result;
      return accountWithoutToken;
    } catch (error) {
      console.error('❌ Error updating GitHub account:', error);
      throw error;
    }
  }

  async deleteGithubAccount(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting GitHub account:', id);
      
      const result = await this.githubAccounts.deleteOne({ id });
      
      if (result.deletedCount === 0) {
        throw new Error(`GitHub account ${id} not found`);
      }
      
      //console.log('✅ GitHub account deleted successfully');
      return true;
    } catch (error) {
      console.error('❌ Error deleting GitHub account:', error);
      throw error;
    }
  }

  async getGithubAccountById(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching GitHub account:', id);
      const account = await this.githubAccounts.findOne({ id });
      
      if (!account) {
        throw new Error('GitHub account not found');
      }
      
      // Return without access token for security
      const { accessToken, ...accountWithoutToken } = account;
      return accountWithoutToken;
    } catch (error) {
      console.error('❌ Error fetching GitHub account:', error);
      throw error;
    }
  }

  async getGithubAccountToken(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔑 Fetching access token for account:', id);
      const account = await this.githubAccounts.findOne({ id });
      
      if (!account) {
        throw new Error('GitHub account not found');
      }
      
      return account.accessToken;
    } catch (error) {
      console.error('❌ Error fetching GitHub account token:', error);
      throw error;
    }
  }

  // ==================== Logs Operations ====================
  async appendLog(campaignId, logEntry) {
    await this.ensureConnected();
    
    try {
      const log = {
        id: uuidv4(),
        campaignId,
        level: logEntry.level,
        message: logEntry.message,
        timestamp: logEntry.timestamp || Date.now(),
        createdAt: new Date().toISOString()
      };
      
      await this.logs.insertOne(log);
      //console.log(`📝 Log appended for campaign ${campaignId}: [${log.level}] ${log.message.substring(0, 50)}...`);
      
      return log;
    } catch (error) {
      console.error('❌ Error appending log:', error);
      // Don't throw here - logging shouldn't break the campaign
    }
  }

  async getLogs(campaignId, since = 0) {
    await this.ensureConnected();
    
    try {
      //console.log('📜 Fetching logs for campaign:', campaignId);
      //console.log('  Since:', since);
      
      const logs = await this.logs
        .find({ 
          campaignId,
          timestamp: { $gt: since }
        })
        .sort({ timestamp: 1 })
        .toArray();
      
      //console.log(`✅ Found ${logs.length} logs`);
      return logs;
    } catch (error) {
      console.error('❌ Error fetching logs:', error);
      throw error;
    }
  }

  async clearLogs(campaignId) {
    await this.ensureConnected();
    
    try {
      //console.log('🧹 Clearing logs for campaign:', campaignId);
      
      const result = await this.logs.deleteMany({ campaignId });
      
      //console.log(`✅ Cleared ${result.deletedCount} logs`);
      return true;
    } catch (error) {
      console.error('❌ Error clearing logs:', error);
      throw error;
    }
  }

  // ==================== GPT Accounts Operations ====================
  async getGPTAccounts() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Listing GPT accounts');
      const accounts = await this.gptAccounts.find({}).sort({ createdAt: -1 }).toArray();
      //console.log(`✅ Found ${accounts.length} GPT accounts`);
      return accounts;
    } catch (error) {
      console.error('❌ Error getting GPT accounts:', error);
      throw error;
    }
  }

  async getGPTAccount(id) {
    await this.ensureConnected();
    
    try {
      //console.log(`📋 Getting GPT account: ${id}`);
      const account = await this.gptAccounts.findOne({ id });
      if (!account) {
        console.warn(`⚠️ GPT account not found: ${id}`);
        return null;
      }
      //console.log(`✅ Found GPT account: ${account.name}`);
      return account;
    } catch (error) {
      console.error('❌ Error getting GPT account:', error);
      throw error;
    }
  }

  async createGPTAccount(data) {
    await this.ensureConnected();
    
    try {
      //console.log(`📝 Creating GPT account: ${data.name}`);
      const account = {
        id: nanoid(),
        name: data.name,
        cookies: data.cookies, // Store cookies JSON
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await this.gptAccounts.insertOne(account);
      //console.log(`✅ GPT account created: ${account.id}`);
      return account;
    } catch (error) {
      console.error('❌ Error creating GPT account:', error);
      throw error;
    }
  }

  async updateGPTAccount(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log(`📝 Updating GPT account: ${id}`);
      const result = await this.gptAccounts.updateOne(
        { id },
        { 
          $set: {
            ...updates,
            updatedAt: new Date().toISOString()
          }
        }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('GPT account not found');
      }
      
      //console.log(`✅ GPT account updated: ${id}`);
      return true;
    } catch (error) {
      console.error('❌ Error updating GPT account:', error);
      throw error;
    }
  }

  async deleteGPTAccount(id) {
    await this.ensureConnected();
    
    try {
      //console.log(`🗑️ Deleting GPT account: ${id}`);
      const result = await this.gptAccounts.deleteOne({ id });
      
      if (result.deletedCount === 0) {
        throw new Error('GPT account not found');
      }
      
      //console.log(`✅ GPT account deleted: ${id}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting GPT account:', error);
      throw error;
    }
  }


  // ==================== View Campaign Operations ====================
  async getViewCampaigns() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching view campaigns from MongoDB...');
      const campaigns = await this.viewCampaigns.find({}).toArray();
      //console.log(`✅ Found ${campaigns.length} view campaigns`);
      return campaigns;
    } catch (error) {
      console.error('❌ Error fetching view campaigns:', error);
      throw error;
    }
  }

  async getViewCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching view campaign:', id);
      const campaign = await this.viewCampaigns.findOne({ id });
      
      if (!campaign) {
        throw new Error('View campaign not found');
      }
      
      //console.log('✅ View campaign found');
      return campaign;
    } catch (error) {
      console.error('❌ Error fetching view campaign:', error);
      throw error;
    }
  }

  async createViewCampaign(campaignData) {
    await this.ensureConnected();
    
    try {
      const campaign = {
        id: uuidv4(),
        name: campaignData.name,
        searchType: campaignData.searchType, // 'keyword' or 'about'
        searchQuery: campaignData.searchQuery,
        repoUrl: campaignData.repoUrl,
        numViews: campaignData.numViews || 1,
        status: 'Idle',
        progress: { 
          completed: 0, 
          total: campaignData.numViews || 1
        },
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      //console.log('💾 Creating view campaign in MongoDB:', campaign.id);
      //console.log('  Name:', campaign.name);
      //console.log('  Search Type:', campaign.searchType);
      //console.log('  Search Query:', campaign.searchQuery);
      //console.log('  Repo URL:', campaign.repoUrl);
      //console.log('  Number of Views:', campaign.numViews);
      
      const result = await this.viewCampaigns.insertOne(campaign);
      
      if (!result.acknowledged) {
        throw new Error('Failed to create view campaign');
      }
      
      //console.log('✅ View campaign created successfully');
      return campaign;
    } catch (error) {
      console.error('❌ Error creating view campaign:', error);
      throw error;
    }
  }

  async updateViewCampaign(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('📝 Updating view campaign:', id);
      
      const updateDoc = {
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      const result = await this.viewCampaigns.updateOne(
        { id },
        { $set: updateDoc }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('View campaign not found');
      }
      
      //console.log('✅ View campaign updated');
      return await this.getViewCampaign(id);
    } catch (error) {
      console.error('❌ Error updating view campaign:', error);
      throw error;
    }
  }

  async deleteViewCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting view campaign:', id);
      
      // Delete associated logs
      await this.logs.deleteMany({ campaignId: id });
      
      // Delete campaign
      const result = await this.viewCampaigns.deleteOne({ id });
      
      if (result.deletedCount === 0) {
        throw new Error('View campaign not found');
      }
      
      //console.log('✅ View campaign deleted');
    } catch (error) {
      console.error('❌ Error deleting view campaign:', error);
      throw error;
    }
  }


  // ==================== Upwork Campaign Operations ====================
  async getUpworkCampaigns() {
    await this.ensureConnected();
    
    try {
      //console.log('📋 Fetching all Upwork campaigns');
      const campaigns = await this.upworkCampaigns.find({}).toArray();
      //console.log(`✅ Found ${campaigns.length} Upwork campaigns`);
      return campaigns;
    } catch (error) {
      console.error('❌ Error fetching Upwork campaigns:', error);
      throw error;
    }
  }

  async getUpworkCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🔍 Fetching Upwork campaign:', id);
      const campaign = await this.upworkCampaigns.findOne({ id });
      if (!campaign) {
        throw new Error('Upwork campaign not found');
      }
      //console.log('✅ Upwork campaign found');
      return campaign;
    } catch (error) {
      console.error('❌ Error fetching Upwork campaign:', error);
      throw error;
    }
  }

  async createUpworkCampaign(campaignData) {
    await this.ensureConnected();
    
    try {
      //console.log('✨ Creating new Upwork campaign:', campaignData.name);
      
      const campaign = {
        id: nanoid(),
        name: campaignData.name,
        category: 'upwork', // Important: Mark as upwork campaign
        upworkSearchInput: campaignData.upworkSearchInput,
        accountGroupId: campaignData.accountGroupId,
        gptAccountId: campaignData.gptAccountId,
        timeCoefficient: campaignData.timeCoefficient || 'balanced',
        delayBetweenRepos: campaignData.delayBetweenRepos || 900000,
        reposPerHour: campaignData.reposPerHour || 4,
        status: 'Idle',
        progress: {
          processed: 0,
          total: 0,
          viable: 0,
          nonViable: 0
        },
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await this.upworkCampaigns.insertOne(campaign);
      
      //console.log('✅ Upwork campaign created:', campaign.id);
      return campaign;
    } catch (error) {
      console.error('❌ Error creating Upwork campaign:', error);
      throw error;
    }
  }

  async updateUpworkCampaign(id, updates) {
    await this.ensureConnected();
    
    try {
      //console.log('🔄 Updating Upwork campaign:', id);
      //console.log('Updates:', updates);
      
      const updateData = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const result = await this.upworkCampaigns.updateOne(
        { id },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        throw new Error('Upwork campaign not found');
      }
      
      //console.log('✅ Upwork campaign updated');
    } catch (error) {
      console.error('❌ Error updating Upwork campaign:', error);
      throw error;
    }
  }

  async deleteUpworkCampaign(id) {
    await this.ensureConnected();
    
    try {
      //console.log('🗑️ Deleting Upwork campaign:', id);
      
      // Delete associated logs
      await this.logs.deleteMany({ campaignId: id });
      
      // Delete campaign
      const result = await this.upworkCampaigns.deleteOne({ id });
      
      if (result.deletedCount === 0) {
        throw new Error('Upwork campaign not found');
      }
      
      //console.log('✅ Upwork campaign deleted');
    } catch (error) {
      console.error('❌ Error deleting Upwork campaign:', error);
      throw error;
    }
  }
  // Add these methods to the Storage class in storage.js

// ==================== Proxy Bulks Operations ====================
async getProxyBulks() {
  await this.ensureConnected();
  
  try {
    //console.log('📋 Fetching proxy bulks from MongoDB...');
    
    // Initialize collection if not exists
    if (!this.proxyBulks) {
      this.proxyBulks = this.db.collection('proxyBulks');
      await this.proxyBulks.createIndex({ id: 1 }, { unique: true });
    }
    
    const bulks = await this.proxyBulks.find({}).toArray();
    //console.log(`✅ Found ${bulks.length} proxy bulks`);
    return bulks;
  } catch (error) {
    console.error('❌ Error fetching proxy bulks:', error);
    throw error;
  }
}

async getProxyBulk(id) {
  await this.ensureConnected();
  
  try {
    //console.log('🔍 Fetching proxy bulk:', id);
    const bulk = await this.proxyBulks.findOne({ id });
    
    if (!bulk) {
      //console.log('⚠️ Proxy bulk not found:', id);
      return null;
    }
    
    //console.log('✅ Proxy bulk found');
    return bulk;
  } catch (error) {
    console.error('❌ Error fetching proxy bulk:', error);
    throw error;
  }
}

async createProxyBulk(data) {
  await this.ensureConnected();
  
  try {
    const bulk = {
      id: nanoid(),
      name: data.name,
      description: data.description || '',
      proxies: data.proxies || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    //console.log('💾 Creating proxy bulk in MongoDB:', bulk.id);
    //console.log('  Name:', bulk.name);
    //console.log('  Proxies:', bulk.proxies.length);
    
    const result = await this.proxyBulks.insertOne(bulk);
    
    if (!result.acknowledged) {
      throw new Error('Failed to insert proxy bulk into database');
    }
    
    //console.log('✅ Proxy bulk created successfully');
    return bulk;
  } catch (error) {
    console.error('❌ Error creating proxy bulk:', error);
    throw error;
  }
}

async updateProxyBulk(id, updates) {
  await this.ensureConnected();
  
  try {
    //console.log('📝 Updating proxy bulk:', id);
    //console.log('  Updates:', Object.keys(updates));
    
    // Add updatedAt timestamp
    updates.updatedAt = new Date().toISOString();
    
    const result = await this.proxyBulks.findOneAndUpdate(
      { id },
      { $set: updates },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      throw new Error(`Proxy bulk ${id} not found`);
    }
    
    //console.log('✅ Proxy bulk updated successfully');
    return result;
  } catch (error) {
    console.error('❌ Error updating proxy bulk:', error);
    throw error;
  }
}

async deleteProxyBulk(id) {
  await this.ensureConnected();
  
  try {
    //console.log('🗑️ Deleting proxy bulk:', id);
    
    const result = await this.proxyBulks.deleteOne({ id });
    
    if (result.deletedCount === 0) {
      throw new Error(`Proxy bulk ${id} not found`);
    }
    
    //console.log('✅ Proxy bulk deleted successfully');
    return true;
  } catch (error) {
    console.error('❌ Error deleting proxy bulk:', error);
    throw error;
  }
}

// ==================== UPDATED GitHub Account Creation ====================
// Replace the existing createGithubAccount method with this:

async createGithubAccount(data) {
  await this.ensureConnected();
  
  try {
    // Generate a unique session ID for sticky proxy sessions
    const sessionId = data.proxy ? `session_${nanoid()}` : null;
    
    const account = {
      id: nanoid(),
      groupId: data.groupId,
      username: data.username,
      accessToken: data.accessToken, // Store encrypted in production
      assignedProxy: data.proxy || null, // Store the proxy string
      proxySessionId: sessionId, // Unique session ID for sticky IP
      status: 'pending',
      repoCount: 0,
      lastUsed: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    //console.log('💾 Creating GitHub account in MongoDB:', account.id);
    //console.log('  Username:', account.username);
    //console.log('  Group ID:', account.groupId);
    if (account.assignedProxy) {
      //console.log('  🔒 Assigned Proxy:', account.assignedProxy.substring(0, 30) + '...');
      //console.log('  🔑 Session ID:', account.proxySessionId);
    }
    
    const result = await this.githubAccounts.insertOne(account);
    
    if (!result.acknowledged) {
      throw new Error('Failed to insert GitHub account into database');
    }
    
    //console.log('✅ GitHub account created successfully');
    
    // Return without access token
    const { accessToken, ...accountWithoutToken } = account;
    return accountWithoutToken;
  } catch (error) {
    console.error('❌ Error creating GitHub account:', error);
    throw error;
  }
}

// ==================== Get GitHub Account with Proxy ====================
// Add this method to get account with proxy details

async getGithubAccountWithProxy(id) {
  await this.ensureConnected();
  
  try {
    //console.log('🔍 Fetching GitHub account with proxy:', id);
    const account = await this.githubAccounts.findOne({ id });
    
    if (!account) {
      throw new Error('GitHub account not found');
    }
    
    //console.log('✅ Account found:', account.username);
    if (account.assignedProxy) {
      //console.log('  🔒 Has assigned proxy with session:', account.proxySessionId);
    }
    
    return account;
  } catch (error) {
    console.error('❌ Error fetching GitHub account with proxy:', error);
    throw error;
  }
}
// ==================== Processed Jobs Operations (Duplicate Detection) ====================

/**
 * Normalize a job title for comparison
 * @param {string} title - The job title to normalize
 * @returns {string} Normalized title
 */
normalizeJobTitle(title) {
  if (!title) return '';
  
  return title
    .toLowerCase()
    .trim()
    // Remove special characters but keep spaces
    .replace(/[^\w\s]/g, '')
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate similarity ratio between two strings using Levenshtein distance
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} Similarity ratio between 0 and 1
 */
calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1;
  
  const editDistance = this.levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Check if a job is a duplicate based on title and description similarity
 * @param {string} title - Job title
 * @param {string} description - Job description
 * @param {number} similarityThreshold - Similarity threshold (0-1), default 0.85
 * @returns {Promise<Object|null>} Returns existing job if duplicate found, null otherwise
 */
async checkJobDuplicate(title, description, similarityThreshold = 0.85) {
  await this.ensureConnected();
  
  try {
    const normalizedTitle = this.normalizeJobTitle(title);
    
    if (!normalizedTitle) {
      return null;
    }
    
    // First, try exact match on normalized title (fastest)
    const exactMatch = await this.processedJobs.findOne({ 
      normalizedTitle 
    });
    
    if (exactMatch) {
      //console.log('🔍 Found exact title match:', exactMatch.title);
      return exactMatch;
    }
    
    // If no exact match, check for similar titles
    // Get all jobs and check similarity (for small datasets this is fine)
    // For large datasets, consider using text search indexes
    const allJobs = await this.processedJobs
      .find({})
      .limit(1000) // Limit to last 1000 jobs for performance
      .sort({ createdAt: -1 })
      .toArray();
    
    for (const job of allJobs) {
      const titleSimilarity = this.calculateSimilarity(
        normalizedTitle,
        job.normalizedTitle
      );
      
      // Check if title is very similar
      if (titleSimilarity >= similarityThreshold) {
        //console.log(`🔍 Found similar job (${Math.round(titleSimilarity * 100)}% match):`, job.title);
        return job;
      }
      
      // Also check description similarity if provided
      if (description && job.description) {
        const normalizedDesc1 = this.normalizeJobTitle(description.substring(0, 200));
        const normalizedDesc2 = this.normalizeJobTitle(job.description.substring(0, 200));
        const descSimilarity = this.calculateSimilarity(normalizedDesc1, normalizedDesc2);
        
        // If both title and description are somewhat similar, consider it a duplicate
        if (titleSimilarity >= 0.7 && descSimilarity >= 0.8) {
          //console.log(`🔍 Found similar job based on title (${Math.round(titleSimilarity * 100)}%) and description (${Math.round(descSimilarity * 100)}%)`);
          return job;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error checking job duplicate:', error);
    return null; // On error, don't block processing
  }
}

/**
 * Store a processed job to prevent future duplicates
 * @param {Object} jobData - Job data to store
 * @returns {Promise<Object>} Stored job document
 */
async storeProcessedJob(jobData) {
  await this.ensureConnected();
  
  try {
    const normalizedTitle = this.normalizeJobTitle(jobData.title);
    
    const processedJob = {
      id: jobData.id || jobData.ciphertext,
      title: jobData.title,
      normalizedTitle,
      description: jobData.description,
      campaignId: jobData.campaignId,
      niche: jobData.niche,
      repoUrl: jobData.repoUrl,
      createdAt: new Date().toISOString(),
      upworkJobUrl: jobData.upworkJobUrl
    };
    
    //console.log('💾 Storing processed job:', processedJob.title);
    
    const result = await this.processedJobs.insertOne(processedJob);
    
    if (!result.acknowledged) {
      throw new Error('Failed to store processed job');
    }
    
    //console.log('✅ Processed job stored successfully');
    return processedJob;
  } catch (error) {
    // If duplicate key error, that's okay - job already exists
    if (error.code === 11000) {
      //console.log('⚠️ Job already stored (duplicate key)');
      return null;
    }
    console.error('❌ Error storing processed job:', error);
    throw error;
  }
}

/**
 * Get all processed jobs for a campaign
 * @param {string} campaignId 
 * @returns {Promise<Array>} Array of processed jobs
 */
async getProcessedJobsForCampaign(campaignId) {
  await this.ensureConnected();
  
  try {
    const jobs = await this.processedJobs
      .find({ campaignId })
      .sort({ createdAt: -1 })
      .toArray();
    
    return jobs;
  } catch (error) {
    console.error('❌ Error fetching processed jobs:', error);
    return [];
  }
}

/**
 * Get processed jobs statistics
 * @returns {Promise<Object>} Statistics object
 */
async getProcessedJobsStats() {
  await this.ensureConnected();
  
  try {
    const total = await this.processedJobs.countDocuments();
    const byNiche = await this.processedJobs.aggregate([
      {
        $group: {
          _id: '$niche',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]).toArray();
    
    return {
      totalProcessed: total,
      byNiche: byNiche.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };
  } catch (error) {
    console.error('❌ Error fetching processed jobs stats:', error);
    return { totalProcessed: 0, byNiche: {} };
  }
}

/**
 * Clear old processed jobs (optional cleanup)
 * @param {number} daysOld - Remove jobs older than this many days
 * @returns {Promise<number>} Number of jobs removed
 */
async clearOldProcessedJobs(daysOld = 30) {
  await this.ensureConnected();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await this.processedJobs.deleteMany({
      createdAt: { $lt: cutoffDate.toISOString() }
    });
    
    //console.log(`🧹 Cleared ${result.deletedCount} old processed jobs`);
    return result.deletedCount;
  } catch (error) {
    console.error('❌ Error clearing old processed jobs:', error);
    return 0;
  }
}
async getScrapeJobsCampaigns() {
  await this.ensureConnected();
  
  try {
    //console.log('📋 Fetching scrape-jobs campaigns from MongoDB...');
    // We use upworkCampaigns collection but filter by category
    const campaigns = await this.upworkCampaigns.find({ category: 'scrape-jobs' }).toArray();
    //console.log(`✅ Found ${campaigns.length} scrape-jobs campaigns`);
    return campaigns;
  } catch (error) {
    console.error('❌ Error fetching scrape-jobs campaigns:', error);
    throw error;
  }
}

async getScrapeJobsCampaign(id) {
  await this.ensureConnected();
  
  try {
    //console.log('🔍 Fetching scrape-jobs campaign:', id);
    const campaign = await this.upworkCampaigns.findOne({ id, category: 'scrape-jobs' });
    
    if (!campaign) {
      throw new Error('Scrape-jobs campaign not found');
    }
    
    //console.log('✅ Scrape-jobs campaign found');
    return campaign;
  } catch (error) {
    console.error('❌ Error fetching scrape-jobs campaign:', error);
    throw error;
  }
}

async createScrapeJobsCampaign(campaignData) {
  await this.ensureConnected();
  
  try {
    console.log('✨ Creating new scrape-jobs campaign:', campaignData.name);
    
    // Parse job entries (separated by ---)
    const jobEntries = campaignData.scrapeJobUrls
      .split('---')
      .map(job => job.trim())
      .filter(job => job.length > 0);
    
    const campaign = {
      id: nanoid(),
      name: campaignData.name,
      category: 'scrape-jobs',
      scrapeJobUrls: jobEntries, // Store as array of manual entries
      scrapeJobNiche: campaignData.scrapeJobNiche, // NEW: Store user-selected niche
      accountGroupId: campaignData.accountGroupId,
      gptAccountId: campaignData.gptAccountId,
      timeCoefficient: campaignData.timeCoefficient || 'balanced',
      delayBetweenRepos: campaignData.delayBetweenRepos || 900000,
      reposPerHour: campaignData.reposPerHour || 4,
      status: 'Idle',
      progress: {
        processed: 0,
        total: jobEntries.length,
        viable: 0, // Not used in manual mode but kept for compatibility
        nonViable: 0,
        duplicates: 0
      },
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await this.upworkCampaigns.insertOne(campaign);
    
    console.log('✅ Scrape-jobs campaign created:', campaign.id);
    console.log('   Total manual jobs:', jobEntries.length);
    console.log('   Selected niche:', campaign.scrapeJobNiche);
    return campaign;
  } catch (error) {
    console.error('❌ Error creating scrape-jobs campaign:', error);
    throw error;
  }
}

async updateScrapeJobsCampaign(id, updates) {
  await this.ensureConnected();
  
  try {
    //console.log('🔄 Updating scrape-jobs campaign:', id);
    
    const updateData = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    
    const result = await this.upworkCampaigns.updateOne(
      { id, category: 'scrape-jobs' },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      throw new Error('Scrape-jobs campaign not found');
    }
    
    //console.log('✅ Scrape-jobs campaign updated');
  } catch (error) {
    console.error('❌ Error updating scrape-jobs campaign:', error);
    throw error;
  }
}

async deleteScrapeJobsCampaign(id) {
  await this.ensureConnected();
  
  try {
    //console.log('🗑️ Deleting scrape-jobs campaign:', id);
    
    // Delete associated logs
    await this.logs.deleteMany({ campaignId: id });
    
    // Delete campaign
    const result = await this.upworkCampaigns.deleteOne({ id, category: 'scrape-jobs' });
    
    if (result.deletedCount === 0) {
      throw new Error('Scrape-jobs campaign not found');
    }
    
    //console.log('✅ Scrape-jobs campaign deleted');
  } catch (error) {
    console.error('❌ Error deleting scrape-jobs campaign:', error);
    throw error;
  }
}

// ==================== Data To Export Operations ====================
/**
 * Store job data before repo creation (Upwork campaigns only)
 * @param {Object} exportData - Job data to store
 * @param {string} exportData.campaignId - Campaign ID
 * @param {string} exportData.title - Job title
 * @param {string} exportData.description - Job description
 * @param {Array<string>} exportData.topics - Repository topics
 * @param {string} exportData.readme - README content
 * @param {string} exportData.category - 'scraper' or 'automation'
 * @param {string} exportData.platformDomain - Platform domain URL
 */
async storeDataToExport(exportData) {
  await this.ensureConnected();
  
  try {
    const data = {
      id: nanoid(),
      campaignId: exportData.campaignId,
      title: exportData.title,
      description: exportData.description,
      topics: exportData.topics || [],
      readme: exportData.readme,
      category: exportData.category,
      platformDomain: exportData.platformDomain || 'None',
      createdAt: new Date().toISOString()
    };
    
    await this.dataToExport.insertOne(data);
    console.log('✅ Data to export stored successfully');
    return data;
  } catch (error) {
    console.error('❌ Error storing data to export:', error);
    throw error;
  }
}

/**
 * Get all export data for a specific campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Array>} Array of export data records
 */
async getExportDataByCampaign(campaignId) {
  await this.ensureConnected();
  
  try {
    const data = await this.dataToExport
      .find({ campaignId })
      .sort({ createdAt: -1 })
      .toArray();
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching export data:', error);
    throw error;
  }
}

/**
 * Get all export data across all campaigns
 * @returns {Promise<Array>} Array of all export data records
 */
async getAllExportData() {
  await this.ensureConnected();
  
  try {
    const data = await this.dataToExport
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching all export data:', error);
    throw error;
  }
}

/**
 * Delete export data for a campaign
 * @param {string} campaignId - Campaign ID
 */
async deleteExportDataByCampaign(campaignId) {
  await this.ensureConnected();
  
  try {
    await this.dataToExport.deleteMany({ campaignId });
    console.log('✅ Export data deleted for campaign');
  } catch (error) {
    console.error('❌ Error deleting export data:', error);
    throw error;
  }
}



  async close() {
    if (this.client) {
      //console.log('👋 Closing MongoDB connection...');
      await this.client.close();
      this.connected = false;
      //console.log('✅ MongoDB connection closed');
    }
  }
}


// Create singleton instance
const storage = new Storage();

// Connect on initialization
storage.connect().catch(error => {
  console.error('❌ Failed to initialize storage:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  //console.log('\n⚠️ Received SIGINT, closing MongoDB connection...');
  await storage.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  ////console.log('\n⚠️ Received SIGTERM, closing MongoDB connection...');
  await storage.close();
  process.exit(0);
});

export { storage };