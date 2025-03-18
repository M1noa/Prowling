#!/usr/bin/env node

const axios = require('axios');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

class ProwlingClient {
    constructor() {
        this.baseUrl = '';
        this.indexers = [];
        this.configPath = path.join(__dirname, 'config.json');
        this.currentMenuLevel = 'main'; // Track current menu level
        this.protocols = {
            torrent: 'torrent',
            usenet: 'usenet'
        };
        this.qbittorrentUrl = '';
        
        // Default theme settings
        this.theme = {
            primary: 'cyan',
            secondary: 'yellow',
            success: 'green',
            error: 'red',
            warning: 'yellow',
            info: 'blue',
            highlight: 'magenta'
        };
        
        // Default UI settings
        this.settings = {
            pageSize: 15,
            defaultSortOrder: 'seeders_desc',
            defaultDownloadDir: '',
            showAdultContent: true,
            showExtendedInfo: false,
            confirmDownloads: true,
            autoRefreshResults: false,
            resultsPerPage: 30,
            displayDensity: 'normal',
            enableNotifications: true,
            notificationSound: true,
            enableKeyboardShortcuts: true,
            autoSaveSearchHistory: true,
            maxSearchHistory: 20,
            enableAnimations: true,
            displayMode: 'auto',
            cacheResults: true,
            cacheDuration: 30 // minutes
        };
        
        // Handle Ctrl+C to navigate back one level instead of exiting immediately
        process.on('SIGINT', () => {
            if (this.currentMenuLevel === 'main') {
                console.log(chalk.yellow('\nGoodbye! ;(\n'));
                process.exit(0);
            } else {
                console.log(chalk.cyan('\nGoing back to previous menu...\n'));
                this.currentMenuLevel = 'main';
                // The SIGINT will interrupt the current prompt, and the loop will continue
            }
        });
    }
    
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                
                // Apply saved theme settings if they exist
                if (config.theme) {
                    this.theme = { ...this.theme, ...config.theme };
                }
                
                // Apply saved UI settings if they exist
                if (config.settings) {
                    this.settings = { ...this.settings, ...config.settings };
                }
                
                return config;
            }
        } catch (error) {
            console.log(chalk.yellow('Could not load config file. Using default settings.'));
        }
        return { serverUrl: '', apiKey: '', qbittorrentUrl: '', theme: this.theme, settings: this.settings };
    }

    saveConfig(serverUrl, apiKey, qbittorrentUrl, theme = this.theme, settings = this.settings) {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify({ 
                serverUrl, 
                apiKey, 
                qbittorrentUrl,
                theme,
                settings
            }, null, 4));
            console.log(chalk.green('✓ Configuration Loaded'));
        } catch (error) {
            console.log(chalk.red(`Failed to save configuration: ${error.message}`));
        }
    }

    async initialize() {
        // Load existing config
        const savedConfig = this.loadConfig();
        
        // Custom prompt theme for better UI
        inquirer.registerPrompt('chalk-pipe', require('inquirer-chalk-pipe'));
        
        // Only prompt for server URL and API key if they're not already set
        // or if they're empty in the config
        let serverUrl = savedConfig.serverUrl;
        let apiKey = savedConfig.apiKey;
        
        if (!serverUrl) {
            const response = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'serverUrl',
                    message: 'Enter Prowlarr server URL (e.g. http://localhost:9696):',
                    validate: (input) => input.startsWith('http') || 'URL must start with http:// or https://',
                    prefix: chalk.cyan('⊡'),
                }
            ]);
            serverUrl = response.serverUrl;
        }
        
        if (!apiKey) {
            const response = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'apiKey',
                    message: 'Enter your Prowlarr API key:',
                    validate: (input) => input.length > 0 || 'API key cannot be empty',
                    prefix: chalk.cyan('⚿'),
                }
            ]);
            apiKey = response.apiKey;
        }

        // Save the config for future use (without asking for qBittorrent URL)
        this.saveConfig(serverUrl, apiKey, savedConfig.qbittorrentUrl || '');

        this.baseUrl = serverUrl;
        this.qbittorrentUrl = savedConfig.qbittorrentUrl || '';
        // Configure axios with the API key
        axios.defaults.headers.common['X-Api-Key'] = apiKey;
        
        const spinner = ora({
            text: 'Connecting to Prowlarr...',
            color: 'cyan',
            spinner: 'dots'
        }).start();

        try {
            // Test connection
            await axios.get(`${this.baseUrl}/api/v1/system/status`);
            spinner.succeed(chalk.green('Connected to Prowlarr'));

            // Fetch indexers
            spinner.start('Fetching indexers...');
            const { data: indexers } = await axios.get(`${this.baseUrl}/api/v1/indexer`);
            this.indexers = indexers;
            spinner.succeed(chalk.green(`Loaded ${indexers.length} indexers`));

            await this.startSearchLoop();
        } catch (error) {
            spinner.fail(chalk.red(`Failed to connect: ${error.message}`));
            process.exit(1);
        }
    }

    async startSearchLoop() {
        console.log(chalk[this.theme.primary]('\n┌─────────────────────────────────────────┐'));
        console.log(chalk[this.theme.primary]('│') + chalk.bold.white(' ⚲ Prowling - Prowlarr Search Client     ') + chalk[this.theme.primary]('│'));
        console.log(chalk[this.theme.primary]('└─────────────────────────────────────────┘\n'));
        
        // Navigation stack to keep track of where we are
        const navigationStack = [];
        
        while (true) {
            this.currentMenuLevel = 'main';
            
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'Main Menu:',
                    prefix: chalk[this.theme.highlight]('⚇'),
                    choices: [
                        { name: '🔍 Search', value: 'search' },
                        { name: '⚙️ Settings', value: 'settings' },
                        { name: '✕ Exit', value: 'exit' }
                    ],
                    loop: true,
                    pageSize: this.settings.pageSize
                }
            ]);
            
            if (action === 'exit') {
                console.log(chalk[this.theme.warning]('\nGoodbye! ⚐\n'));
                process.exit(0);
            } else if (action === 'settings') {
                await this.showSettingsMenu();
                continue;
            }
            
            // If we're here, user selected search
            const { category } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'category',
                    message: 'Select a category to search:',
                    prefix: chalk[this.theme.highlight]('⚇'),
                    choices: [
                        { name: '⚓ Movies', value: 2000 },
                        { name: '⚔ TV Shows', value: 5000 },
                        ...(this.settings.showAdultContent ? [{ name: '⚠ Adult Content', value: [6000, 100051, 126537, 100007, 6060, 100015, 6050, 6070, 6080, 6090, 100017, 100018, 100019, 100020] }] : []),
                        { name: '⊡ All Categories', value: 'all' },
                        { name: '← Back', value: 'back' }
                    ],
                    loop: true,
                    pageSize: this.settings.pageSize
                }
            ]);
            
            if (category === 'back') {
                continue;
            }

            if (category === 'exit') {
                console.log(chalk.yellow('\nGoodbye! ⚐\n'));
                process.exit(0);
            }
            
            const { query } = await inquirer.prompt([{
                type: 'input',
                name: 'query',
                message: `Enter search query (or "back" to return):`,
                prefix: chalk.yellow('⚲'),
            }]);

            if (query.toLowerCase() === 'back') {
                continue;
            }

            if (query.toLowerCase() === 'exit') {
                console.log(chalk.yellow('\nGoodbye! ⚐\n'));
                process.exit(0);
            }

            // Use the main search API endpoint instead of individual indexer searches
            const spinner = ora({
                text: 'Searching across indexers...',
                color: 'yellow',
                spinner: 'dots'
            }).start();
            
            // Prepare search parameters
            const searchParams = {
                query: query,
                type: 'search'
            };
            
            // Add categories if not searching all
            if (category !== 'all') {
                // Handle both single category and array of categories
                searchParams.categories = Array.isArray(category) ? category : [category];
            }
            
            // Get all indexer IDs
            const indexerIds = this.indexers.map(indexer => indexer.id);
            if (indexerIds.length > 0) {
                searchParams.indexerIds = indexerIds;
            }
            
            try {
                // Use the main search endpoint
                const { data: results } = await axios.get(`${this.baseUrl}/api/v1/search`, {
                    params: searchParams,
                    paramsSerializer: params => {
                        // Handle arrays in params properly
                        const parts = [];
                        Object.keys(params).forEach(key => {
                            const value = params[key];
                            if (Array.isArray(value)) {
                                value.forEach(v => parts.push(`${key}=${v}`));
                            } else {
                                parts.push(`${key}=${encodeURIComponent(value)}`);
                            }
                        });
                        return parts.join('&');
                    }
                });
                
                spinner.succeed(chalk.green(`Search completed - Found ${results.length} results`));
                
                if (results.length === 0) {
                    console.log(chalk.yellow('\nNo results found 😕\n'));
                    continue;
                }
                
                // Format file sizes nicely
                const formatSize = (bytes) => {
                    if (!bytes) return 'Unknown';
                    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(1024));
                    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
                };
                
                // Helper to determine protocol icon
                const getProtocolIcon = (result) => {
                    if (result.protocol === this.protocols.usenet) {
                        return chalk.blue('⚡NZB');
                    } else {
                        return result.seeders && result.seeders > 0 ? 
                            chalk.green(`⚡${result.seeders}`) : 
                            chalk.yellow('Unkn');
                    }
                };
                
                const choices = results.map(result => ({
                    name: `${chalk.green(result.title)} ${chalk.dim('|')} ${chalk.blue(result.indexer)} ${chalk.dim('|')} ${chalk.yellow(formatSize(result.size))} ${chalk.dim('|')} ${getProtocolIcon(result)}`,
                    value: result,
                    short: result.title
                }));

                let currentResults = results;
                let filteredResults = null;
                let isFiltered = false;

                while (true) {
                    const { selected } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'selected',
                            message: isFiltered ? 'Select an item from filtered results:' : 'Select an item to view details:',
                            prefix: chalk.cyan('⚟'),
                            choices: [
                                ...currentResults.map(result => ({
                                    name: `${chalk.green(result.title)} ${chalk.dim('|')} ${chalk.blue(`${result.indexer} (${this.indexers.find(i => i.name === result.indexer)?.priority || 0})`)} ${chalk.dim('|')} ${chalk.yellow(formatSize(result.size))} ${chalk.dim('|')} ${getProtocolIcon(result)}`,
                                    value: result,
                                    short: result.title
                                })),
                                new inquirer.Separator(),
                                { name: '🔍 Search within results', value: 'search_results' },
                                { name: '⚡ Sort results', value: 'sort_results' },
                                isFiltered ? { name: '↺ Show all results', value: 'show_all' } : null,
                                { name: '← Back to search', value: null }
                            ].filter(Boolean),
                            pageSize: 15,
                            loop: true,
                            highlight: true
                        }
                    ]);

                    if (selected === 'sort_results') {
                        const { sortBy } = await inquirer.prompt([
                            {
                                type: 'list',
                                name: 'sortBy',
                                message: 'Sort results by:',
                                prefix: chalk.yellow('⚡'),
                                choices: [
                                    { name: 'Title (A-Z)', value: 'title_asc' },
                                    { name: 'Title (Z-A)', value: 'title_desc' },
                                    { name: 'Seeders (High to Low)', value: 'seeders_desc' },
                                    { name: 'Seeders (Low to High)', value: 'seeders_asc' },
                                    { name: 'Size (Large to Small)', value: 'size_desc' },
                                    { name: 'Size (Small to Large)', value: 'size_asc' },
                                    { name: 'Date (Newest First)', value: 'date_desc' },
                                    { name: 'Date (Oldest First)', value: 'date_asc' },
                                    { name: 'Protocol (Usenet/Torrent)', value: 'protocol' },
                                    { name: 'Indexer Priority (High to Low)', value: 'indexer_priority_desc' },
                                    { name: 'Indexer Priority (Low to High)', value: 'indexer_priority_asc' }
                                ]
                            }
                        ]);

                        currentResults = [...currentResults].sort((a, b) => {
                            switch (sortBy) {
                                case 'title_asc':
                                    return a.title.localeCompare(b.title);
                                case 'title_desc':
                                    return b.title.localeCompare(a.title);
                                case 'seeders_desc':
                                    return (b.seeders || 0) - (a.seeders || 0);
                                case 'seeders_asc':
                                    return (a.seeders || 0) - (b.seeders || 0);
                                case 'size_desc':
                                    return (b.size || 0) - (a.size || 0);
                                case 'size_asc':
                                    return (a.size || 0) - (b.size || 0);
                                case 'date_desc':
                                    return new Date(b.publishDate || 0) - new Date(a.publishDate || 0);
                                case 'date_asc':
                                    return new Date(a.publishDate || 0) - new Date(b.publishDate || 0);
                                case 'protocol':
                                    // Sort by protocol (usenet first, then torrent)
                                    if (a.protocol === this.protocols.usenet && b.protocol !== this.protocols.usenet) return -1;
                                    if (a.protocol !== this.protocols.usenet && b.protocol === this.protocols.usenet) return 1;
                                    return 0;
                                case 'indexer_priority_desc':
                                    // Get indexer priority from this.indexers
                                    const priorityA1 = this.indexers.find(i => i.name === a.indexer)?.priority || 0;
                                    const priorityB1 = this.indexers.find(i => i.name === b.indexer)?.priority || 0;
                                    return priorityB1 - priorityA1; // Higher priority first
                                case 'indexer_priority_asc':
                                    // Get indexer priority from this.indexers
                                    const priorityA2 = this.indexers.find(i => i.name === a.indexer)?.priority || 0;
                                    const priorityB2 = this.indexers.find(i => i.name === b.indexer)?.priority || 0;
                                    return priorityA2 - priorityB2; // Lower priority first
                                default:
                                    return 0;
                            }
                        });
                        continue;
                    } else if (selected === 'search_results') {
                        const { searchQuery } = await inquirer.prompt([
                            {
                                type: 'input',
                                name: 'searchQuery',
                                message: 'Enter search term:',
                                prefix: chalk.yellow('🔍')
                            }
                        ]);

                        if (searchQuery.trim()) {
                            const searchTerm = searchQuery.toLowerCase();
                            filteredResults = results.filter(result =>
                                result.title.toLowerCase().includes(searchTerm)
                            );

                            if (filteredResults.length === 0) {
                                console.log(chalk.yellow('\nNo matches found in current results 😕\n'));
                                await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to go back...' }]);
                                continue;
                            }

                            currentResults = filteredResults;
                            isFiltered = true;
                            console.log(chalk.green(`\nFound ${filteredResults.length} matching results\n`));
                            continue;
                        }
                    } else if (selected === 'show_all') {
                        currentResults = results;
                        filteredResults = null;
                        isFiltered = false;
                        continue;
                    } else if (!selected) {
                        break;
                    } else {
                        // Store current results for back navigation
                        navigationStack.push({ type: 'results', data: results });
                    
                        let viewingDetails = true;
                        while (viewingDetails) {
                            this.currentMenuLevel = 'details'; // Set menu level to details
                            console.log('\n' + chalk.cyan('┌─────────────────────────────────────────┐'));
                            console.log(chalk.cyan('│') + chalk.bold.white(' ⚏ Item Details          ') + chalk.cyan('│'));
                            console.log(chalk.cyan('└─────────────────────────────────────────┘'));
                            console.log(chalk.bold('Title: ') + chalk.white(selected.title));
                            console.log(chalk.bold('Size: ') + chalk.yellow(formatSize(selected.size)));
                            console.log(chalk.bold('Indexer: ') + chalk.blue(selected.indexer));
                            console.log(chalk.bold('Protocol: ') + chalk.magenta(selected.protocol || 'Unknown'));
                            console.log(chalk.bold('Category: ') + chalk.magenta(selected.categories?.join(', ') || 'Unknown'));
                            if (selected.protocol === this.protocols.torrent) {
                                console.log(chalk.bold('Seeders: ') + chalk.green(selected.seeders || 'Unknown'));
                                console.log(chalk.bold('Leechers: ') + chalk.red(selected.leechers || 'Unknown'));
                            }
                            console.log(chalk.bold('Published: ') + chalk.white(new Date(selected.publishDate).toLocaleString() || 'Unknown'));
                        
                            // Build choices array dynamically based on available URLs
                            const actionChoices = [];
                            
                            if (selected.downloadUrl) {
                                if (selected.protocol === this.protocols.usenet) {
                                    actionChoices.push({ name: '⚡ Copy NZB URL', value: 'download_url' });
                                } else {
                                    actionChoices.push({ name: '⚟ Copy torrent URL', value: 'download_url' });
                                }
                            }
                            
                            if (selected.magnetUrl) {
                                actionChoices.push({ name: '⚲ Copy magnet URL', value: 'magnet_url' });
                                if (this.qbittorrentUrl) {
                                    actionChoices.push({ name: '⚓ Open in qBittorrent', value: 'open_qbittorrent' });
                                }
                            } else if (selected.downloadUrl && selected.protocol === this.protocols.torrent && this.qbittorrentUrl) {
                                actionChoices.push({ name: '⚓ Open in qBittorrent', value: 'open_qbittorrent' });
                            }
                            
                            actionChoices.push(
                                { name: '⚲ View more details', value: 'more_info' },
                                { name: '← Back to results', value: 'back' },
                                { name: '⌂ Back to main menu', value: 'main_menu' }
                            );
                            
                            const { action } = await inquirer.prompt([
                                {
                                    type: 'list',
                                    name: 'action',
                                    message: 'What would you like to do?',
                                    prefix: chalk.green('⚡'),
                                    choices: actionChoices,
                                    loop: true
                                }
                            ]);

                            if (action === 'download_client') {
                                await this.downloadToClient(selected);
                            } else if (action === 'download_url') {
                                const urlType = selected.protocol === this.protocols.usenet ? 'NZB URL' : 'Torrent URL';
                                console.log(chalk.cyan(`\n${urlType}:`));
                                console.log(chalk.white(selected.downloadUrl));
                                console.log(chalk.gray('\nPress Enter to go back...'));
                                await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
                            } else if (action === 'magnet_url') {
                                console.log(chalk.cyan('\nMagnet URL:'));
                                console.log(chalk.white(selected.magnetUrl || 'Not available'));
                                console.log(chalk.gray('\nPress Enter to go back...'));
                                await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
                            } else if (action === 'open_qbittorrent') {
                                await this.openInQBittorrent(selected);
                            } else if (action === 'more_info') {
                                await this.showExtendedDetails(selected);
                            } else if (action === 'back') {
                                viewingDetails = false;
                            } else if (action === 'main_menu') {
                                // Clear navigation stack to return to main menu
                                navigationStack.length = 0;
                                viewingDetails = false;
                                break; // Break out of the results viewing loop too
                            }
                        } // Closing brace for while (viewingDetails) loop
                    }
                }
                
                // User selected 'Back to search'
                if (navigationStack.length > 0) {
                    // If we have navigation history
                    const previousState = navigationStack.pop();
                    if (previousState.type === 'results') {
                        // Restore previous results and redisplay them
                        currentResults = previousState.data;
                        filteredResults = null;
                        isFiltered = false;
                        continue;
                    }
                }
                // If no history or not results, continue to main search
                continue;
            } catch (error) {
                spinner.fail(chalk.red(`Search failed: ${error.message}`));
                if (error.response?.status === 400) {
                    console.log(chalk.red('Invalid search parameters. Please try again with different criteria.'));
                }
                console.log(chalk.gray('\nPress Enter to go back...'));
                await inquirer.prompt([{ type: 'input', name: '', message: '' }]);
            }
        }
    }
    // Helper method to show extended details for an item
    async showExtendedDetails(item) {
        const spinner = ora({
            text: 'Fetching extended information...',
            color: 'cyan',
            spinner: 'dots'
        }).start();
        
        try {
            // In a real implementation, you might fetch additional details from the API
            // For now, we'll just display what we have in a more detailed format
            spinner.succeed(chalk.green('Extended information loaded'));
            
            console.log('\n' + chalk.cyan('┌─────────────────────────────────────────┐'));
            console.log(chalk.cyan('│') + chalk.bold.white(' ⚲ Extended Details ') + chalk.cyan('│'));
            console.log(chalk.cyan('└─────────────────────────────────────────┘'));
            
            // Display all available properties in the item object
            console.log(chalk.bold('\nTechnical Information:'));
            
            // Format the JSON data for better readability
            const detailsToShow = {
                guid: item.guid || 'Not available',
                infoUrl: item.infoUrl || 'Not available',
                commentUrl: item.commentUrl || 'Not available',
                downloadUrl: item.downloadUrl || 'Not available',
                protocol: item.protocol === this.protocols.torrent ? (item.magnetUrl || 'Not available') : 'Not applicable for Usenet',
                quality: item.quality || 'Not available',
                indexerId: item.indexerId || 'Not available',
                downloadVolumeFactor: item.downloadVolumeFactor || 'Not available',
                uploadVolumeFactor: item.uploadVolumeFactor || 'Not available'
            };
            
            // Display each property
            Object.entries(detailsToShow).forEach(([key, value]) => {
                console.log(chalk.bold(`${key.charAt(0).toUpperCase() + key.slice(1)}: `) + 
                    chalk.white(value));
            });
            
            // Display description if available
            if (item.description) {
                console.log('\n' + chalk.bold('Description:'));
                console.log(chalk.white(item.description));
            }
            
            console.log(chalk.gray('\nPress Enter to go back...'));
            await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
            
        } catch (error) {
            spinner.fail(chalk.red(`Failed to fetch extended information: ${error.message}`));
            console.log(chalk.gray('\nPress Enter to go back...'));
            await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
        }
    }
    async downloadToClient(selected) {
        const spinner = ora({
            text: 'Sending to download client...',
            color: 'cyan',
            spinner: 'dots'
        }).start();

        try {
            if (!this.downloadClient) {
                spinner.fail(chalk.red('No download client configured'));
                return;
            }

            const downloadData = {
                title: selected.title,
                downloadUrl: selected.downloadUrl,
                magnetUrl: selected.magnetUrl,
                protocol: selected.protocol
            };

            await axios.post(`${this.baseUrl}/api/v1/release`, downloadData);
            spinner.succeed(chalk.green('✓ Sent to download client'));
        } catch (error) {
            spinner.fail(chalk.red(`Failed to send to download client: ${error.message}`));
        }

        console.log(chalk.gray('\nPress Enter to go back...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }

    async openInQBittorrent(selected) {
        const spinner = ora({
            text: 'Sending to qBittorrent...',
            color: 'cyan',
            spinner: 'dots'
        }).start();

        try {
            if (!this.qbittorrentUrl) {
                spinner.fail(chalk.red('qBittorrent URL not configured'));
                return;
            }

            // Determine which URL to use (magnet preferred over torrent file)
            const url = selected.magnetUrl || selected.downloadUrl;
            if (!url) {
                spinner.fail(chalk.red('No valid URL available for this item'));
                return;
            }

            // Send to qBittorrent Web API
            const formData = new URLSearchParams();
            formData.append('urls', url);

            await axios.post(`${this.qbittorrentUrl}/api/v2/torrents/add`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            spinner.succeed(chalk.green('✓ Sent to qBittorrent'));
        } catch (error) {
            spinner.fail(chalk.red(`Failed to send to qBittorrent: ${error.message}`));
            console.log(chalk.yellow('\nTip: Make sure qBittorrent WebUI is enabled and the URL is correct.'));
            console.log(chalk.yellow('You may need to login to qBittorrent WebUI first in your browser.'));
        }

        console.log(chalk.gray('\nPress Enter to go back...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }

    async showSettingsMenu() {
        this.currentMenuLevel = 'settings';
        
        console.log(chalk[this.theme.primary]('\n┌─────────────────────────────────────────┐'));
        console.log(chalk[this.theme.primary]('│') + chalk.bold.white(' ⚙️ Settings Menu                      ') + chalk[this.theme.primary]('│'));
        console.log(chalk[this.theme.primary]('└─────────────────────────────────────────┘\n'));
        
        while (true) {
            const { settingOption } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'settingOption',
                    message: 'Select a setting to customize:',
                    prefix: chalk[this.theme.highlight]('⚙️'),
                    choices: [
                        { name: '🔌 Connection Settings', value: 'connection' },
                        { name: '🎨 Theme Colors', value: 'theme' },
                        { name: '🖥️ UI Preferences', value: 'ui' },
                        { name: '📥 Download Settings', value: 'download' },
                        { name: '🔍 Search Preferences', value: 'search' },
                        { name: '👁️ Appearance Settings', value: 'appearance' },
                        { name: '⌨️ Keyboard Shortcuts', value: 'keyboard' },
                        { name: '🔔 Notification Settings', value: 'notifications' },
                        { name: '⚡ Performance Settings', value: 'performance' },
                        { name: '↺ Reset to Default Settings', value: 'reset' },
                        { name: '← Back to Main Menu', value: 'back' }
                    ],
                    loop: true,
                    pageSize: this.settings.pageSize
                }
            ]);
            
            if (settingOption === 'back') {
                return;
            } else if (settingOption === 'reset') {
                const { confirm } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: 'Are you sure you want to reset all settings to default?',
                        default: false
                    }
                ]);
                
                if (confirm) {
                    // Reset theme and settings to default
                    this.theme = {
                        primary: 'cyan',
                        secondary: 'yellow',
                        success: 'green',
                        error: 'red',
                        warning: 'yellow',
                        info: 'blue',
                        highlight: 'magenta'
                    };
                    
                    this.settings = {
                        pageSize: 15,
                        defaultSortOrder: 'seeders_desc',
                        defaultDownloadDir: '',
                        showAdultContent: true,
                        showExtendedInfo: false,
                        confirmDownloads: true,
                        autoRefreshResults: false,
                        resultsPerPage: 30,
                        displayDensity: 'normal',
                        enableNotifications: true,
                        notificationSound: true,
                        enableKeyboardShortcuts: true,
                        autoSaveSearchHistory: true,
                        maxSearchHistory: 20,
                        enableAnimations: true,
                        displayMode: 'auto',
                        cacheResults: true,
                        cacheDuration: 30
                    };
                    
                    // Save the reset configuration
                    this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
                    console.log(chalk[this.theme.success]('✓ Settings reset to default'));
                }
                continue;
            }
            
            switch (settingOption) {
                case 'connection':
                    await this.customizeConnectionSettings();
                    break;
                case 'theme':
                    await this.customizeTheme();
                    break;
                case 'ui':
                    await this.customizeUI();
                    break;
                case 'download':
                    await this.customizeDownloadSettings();
                    break;
                case 'search':
                    await this.customizeSearchPreferences();
                    break;
                case 'appearance':
                    await this.customizeAppearanceSettings();
                    break;
                case 'keyboard':
                    await this.customizeKeyboardShortcuts();
                    break;
                case 'notifications':
                    await this.customizeNotificationSettings();
                    break;
                case 'performance':
                    await this.customizePerformanceSettings();
                    break;
            }
        }
    }
    
    async customizeTheme() {
        const availableColors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];
        
        console.log(chalk[this.theme.info]('\n📝 Customize Theme Colors'));
        console.log(chalk[this.theme.secondary]('Select colors for different elements of the application.\n'));
        
        const { themeElement } = await inquirer.prompt([
            {
                type: 'list',
                name: 'themeElement',
                message: 'Select an element to customize:',
                choices: [
                    { name: 'Primary Color (Headers, Borders)', value: 'primary' },
                    { name: 'Secondary Color (Subtitles, Info)', value: 'secondary' },
                    { name: 'Success Color (Confirmations)', value: 'success' },
                    { name: 'Error Color (Error Messages)', value: 'error' },
                    { name: 'Warning Color (Warnings, Alerts)', value: 'warning' },
                    { name: 'Info Color (Information Messages)', value: 'info' },
                    { name: 'Highlight Color (Selected Items)', value: 'highlight' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (themeElement === 'back') {
            return;
        }
        
        const { colorChoice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'colorChoice',
                message: `Choose a color for ${themeElement}:`,
                choices: availableColors.map(color => ({
                    name: `${chalk[color](color)}`,
                    value: color
                })),
                loop: true
            }
        ]);
        
        // Update the theme with the new color choice
        this.theme[themeElement] = colorChoice;
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${themeElement} color updated to ${colorChoice}`));
        
        // Show a preview of the updated theme
        console.log(chalk[this.theme.info]('\nTheme Preview:'));
        console.log(chalk[this.theme.primary]('Primary Text'));
        console.log(chalk[this.theme.secondary]('Secondary Text'));
        console.log(chalk[this.theme.success]('Success Message'));
        console.log(chalk[this.theme.error]('Error Message'));
        console.log(chalk[this.theme.warning]('Warning Message'));
        console.log(chalk[this.theme.info]('Info Message'));
        console.log(chalk[this.theme.highlight]('Highlighted Item'));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    
    async customizeUI() {
        console.log(chalk[this.theme.info]('\n📝 Customize UI Preferences'));
        console.log(chalk[this.theme.secondary]('Adjust how the application interface behaves.\n'));
        
        const { uiSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'uiSetting',
                message: 'Select a UI setting to customize:',
                choices: [
                    { name: 'Page Size (Items per page in menus)', value: 'pageSize' },
                    { name: 'Results Per Page (Search results)', value: 'resultsPerPage' },
                    { name: 'Show Extended Info by Default', value: 'showExtendedInfo' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (uiSetting === 'back') {
            return;
        }
        
        if (uiSetting === 'pageSize' || uiSetting === 'resultsPerPage') {
            const { value } = await inquirer.prompt([
                {
                    type: 'number',
                    name: 'value',
                    message: `Enter new value for ${uiSetting}:`,
                    default: this.settings[uiSetting],
                    validate: (input) => {
                        const num = parseInt(input);
                        return (num > 0 && num <= 100) ? true : 'Please enter a number between 1 and 100';
                    }
                }
            ]);
            
            this.settings[uiSetting] = value;
        } else if (uiSetting === 'showExtendedInfo') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Show extended information by default?',
                    default: this.settings.showExtendedInfo
                }
            ]);
            
            this.settings.showExtendedInfo = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${uiSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    
    async customizeDownloadSettings() {
        console.log(chalk[this.theme.info]('\n📝 Customize Download Settings'));
        console.log(chalk[this.theme.secondary]('Configure how downloads are handled.\n'));
        
        const { downloadSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'downloadSetting',
                message: 'Select a download setting to customize:',
                choices: [
                    { name: 'Default Download Directory', value: 'defaultDownloadDir' },
                    { name: 'Confirm Downloads', value: 'confirmDownloads' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (downloadSetting === 'back') {
            return;
        }
        
        if (downloadSetting === 'defaultDownloadDir') {
            const { value } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'value',
                    message: 'Enter default download directory:',
                    default: this.settings.defaultDownloadDir
                }
            ]);
            
            this.settings.defaultDownloadDir = value;
        } else if (downloadSetting === 'confirmDownloads') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Confirm before downloading?',
                    default: this.settings.confirmDownloads
                }
            ]);
            
            this.settings.confirmDownloads = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${downloadSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    
    async customizeSearchPreferences() {
        console.log(chalk[this.theme.info]('\n📝 Customize Search Preferences'));
        console.log(chalk[this.theme.secondary]('Configure how search results are displayed and sorted.\n'));
        
        const { searchSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'searchSetting',
                message: 'Select a search setting to customize:',
                choices: [
                    { name: 'Default Sort Order', value: 'defaultSortOrder' },
                    { name: 'Show Adult Content', value: 'showAdultContent' },
                    { name: 'Auto-Refresh Results', value: 'autoRefreshResults' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (searchSetting === 'back') {
            return;
        }
        
        if (searchSetting === 'defaultSortOrder') {
            const { value } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'value',
                    message: 'Select default sort order:',
                    choices: [
                        { name: 'Title (A-Z)', value: 'title_asc' },
                        { name: 'Title (Z-A)', value: 'title_desc' },
                        { name: 'Seeders (High to Low)', value: 'seeders_desc' },
                        { name: 'Seeders (Low to High)', value: 'seeders_asc' },
                        { name: 'Size (Large to Small)', value: 'size_desc' },
                        { name: 'Size (Small to Large)', value: 'size_asc' },
                        { name: 'Date (Newest First)', value: 'date_desc' },
                        { name: 'Date (Oldest First)', value: 'date_asc' }
                    ],
                    default: this.settings.defaultSortOrder
                }
            ]);
            
            this.settings.defaultSortOrder = value;
        } else if (searchSetting === 'showAdultContent' || searchSetting === 'autoRefreshResults') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: `Enable ${searchSetting === 'showAdultContent' ? 'adult content' : 'auto-refresh results'}?`,
                    default: this.settings[searchSetting]
                }
            ]);
            
            this.settings[searchSetting] = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${searchSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    async customizeConnectionSettings() {
        console.log(chalk[this.theme.info]('\n📝 Customize Connection Settings'));
        console.log(chalk[this.theme.secondary]('Configure connection to Prowlarr and other services.\n'));
        
        const { connectionSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'connectionSetting',
                message: 'Select a connection setting to customize:',
                choices: [
                    { name: 'Prowlarr Server URL', value: 'serverUrl' },
                    { name: 'Prowlarr API Key', value: 'apiKey' },
                    { name: 'qBittorrent WebUI URL', value: 'qbittorrentUrl' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (connectionSetting === 'back') {
            return;
        }
        
        if (connectionSetting === 'serverUrl') {
            const { value } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'value',
                    message: 'Enter Prowlarr server URL:',
                    default: this.baseUrl,
                    validate: (input) => input.startsWith('http') || 'URL must start with http:// or https://'
                }
            ]);
            
            this.baseUrl = value;
            
            // Test the new connection
            const spinner = ora({
                text: 'Testing connection to Prowlarr...',
                color: 'cyan',
                spinner: 'dots'
            }).start();
            
            try {
                await axios.get(`${this.baseUrl}/api/v1/system/status`);
                spinner.succeed(chalk.green('Connected to Prowlarr successfully'));
                
                // Refresh indexers with new URL
                spinner.start('Refreshing indexers...');
                const { data: indexers } = await axios.get(`${this.baseUrl}/api/v1/indexer`);
                this.indexers = indexers;
                spinner.succeed(chalk.green(`Loaded ${indexers.length} indexers`));
            } catch (error) {
                spinner.fail(chalk.red(`Failed to connect: ${error.message}`));
                console.log(chalk.yellow('Settings saved, but connection failed. Please check the URL.'));
            }
        } else if (connectionSetting === 'apiKey') {
            const { value } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'value',
                    message: 'Enter Prowlarr API key:',
                    validate: (input) => input.length > 0 || 'API key cannot be empty'
                }
            ]);
            
            // Update the API key
            axios.defaults.headers.common['X-Api-Key'] = value;
            
            // Test the new API key
            const spinner = ora({
                text: 'Testing API key...',
                color: 'cyan',
                spinner: 'dots'
            }).start();
            
            try {
                await axios.get(`${this.baseUrl}/api/v1/system/status`);
                spinner.succeed(chalk.green('API key validated successfully'));
                
                // Refresh indexers with new API key
                spinner.start('Refreshing indexers...');
                const { data: indexers } = await axios.get(`${this.baseUrl}/api/v1/indexer`);
                this.indexers = indexers;
                spinner.succeed(chalk.green(`Loaded ${indexers.length} indexers`));
            } catch (error) {
                spinner.fail(chalk.red(`Failed to authenticate: ${error.message}`));
                console.log(chalk.yellow('Settings saved, but authentication failed. Please check the API key.'));
            }
        } else if (connectionSetting === 'qbittorrentUrl') {
            const { value } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'value',
                    message: 'Enter qBittorrent WebUI URL (leave empty to disable):',
                    default: this.qbittorrentUrl,
                    validate: (input) => !input || input.startsWith('http') ? true : 'URL must start with http:// or https://'
                }
            ]);
            
            this.qbittorrentUrl = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${connectionSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    async customizeAppearanceSettings() {
        console.log(chalk[this.theme.info]('\n📝 Customize Appearance Settings'));
        console.log(chalk[this.theme.secondary]('Configure how the application looks and feels.\n'));
        
        const { appearanceSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'appearanceSetting',
                message: 'Select an appearance setting to customize:',
                choices: [
                    { name: 'Display Density', value: 'displayDensity' },
                    { name: 'Enable Animations', value: 'enableAnimations' },
                    { name: 'Display Mode', value: 'displayMode' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (appearanceSetting === 'back') {
            return;
        }
        
        if (appearanceSetting === 'displayDensity') {
            const { value } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'value',
                    message: 'Select display density:',
                    choices: [
                        { name: 'Compact - Show more items with less spacing', value: 'compact' },
                        { name: 'Normal - Balanced spacing', value: 'normal' },
                        { name: 'Comfortable - More spacing between items', value: 'comfortable' }
                    ],
                    default: this.settings.displayDensity
                }
            ]);
            
            this.settings.displayDensity = value;
        } else if (appearanceSetting === 'enableAnimations') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Enable UI animations?',
                    default: this.settings.enableAnimations
                }
            ]);
            
            this.settings.enableAnimations = value;
        } else if (appearanceSetting === 'displayMode') {
            const { value } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'value',
                    message: 'Select display mode:',
                    choices: [
                        { name: 'Auto - Follow system settings', value: 'auto' },
                        { name: 'Light Mode', value: 'light' },
                        { name: 'Dark Mode', value: 'dark' }
                    ],
                    default: this.settings.displayMode
                }
            ]);
            
            this.settings.displayMode = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${appearanceSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    async customizeKeyboardShortcuts() {
        console.log(chalk[this.theme.info]('\n📝 Customize Keyboard Shortcuts'));
        console.log(chalk[this.theme.secondary]('Configure keyboard shortcuts for faster navigation.\n'));
        
        const { keyboardSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'keyboardSetting',
                message: 'Select a keyboard shortcut setting to customize:',
                choices: [
                    { name: 'Enable Keyboard Shortcuts', value: 'enableKeyboardShortcuts' },
                    { name: 'Configure Search Shortcuts', value: 'searchShortcuts' },
                    { name: 'Configure Navigation Shortcuts', value: 'navigationShortcuts' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (keyboardSetting === 'back') {
            return;
        }
        
        if (keyboardSetting === 'enableKeyboardShortcuts') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Enable keyboard shortcuts?',
                    default: this.settings.enableKeyboardShortcuts
                }
            ]);
            
            this.settings.enableKeyboardShortcuts = value;
            console.log(chalk[this.theme.info]('\nKeyboard shortcuts ' + (value ? 'enabled' : 'disabled')));
            if (value) {
                console.log(chalk[this.theme.secondary]('Available shortcuts:'));
                console.log(chalk[this.theme.secondary]('- Ctrl+S: Quick search'));
                console.log(chalk[this.theme.secondary]('- Ctrl+D: Download selected item'));
                console.log(chalk[this.theme.secondary]('- Ctrl+R: Refresh results'));
                console.log(chalk[this.theme.secondary]('- Ctrl+H: View search history'));
                console.log(chalk[this.theme.secondary]('- Ctrl+F: Filter results'));
            }
        } else if (keyboardSetting === 'searchShortcuts' || keyboardSetting === 'navigationShortcuts') {
            console.log(chalk[this.theme.info](`\n${keyboardSetting === 'searchShortcuts' ? 'Search' : 'Navigation'} Shortcuts`));
            console.log(chalk[this.theme.secondary]('These shortcuts are currently not customizable.'));
            console.log(chalk[this.theme.secondary]('This feature will be available in a future update.'));
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ Keyboard settings updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    async customizeNotificationSettings() {
        console.log(chalk[this.theme.info]('\n📝 Customize Notification Settings'));
        console.log(chalk[this.theme.secondary]('Configure how and when notifications appear.\n'));
        
        const { notificationSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'notificationSetting',
                message: 'Select a notification setting to customize:',
                choices: [
                    { name: 'Enable Notifications', value: 'enableNotifications' },
                    { name: 'Notification Sound', value: 'notificationSound' },
                    { name: 'Notification Types', value: 'notificationTypes' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (notificationSetting === 'back') {
            return;
        }
        
        if (notificationSetting === 'enableNotifications') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Enable notifications?',
                    default: this.settings.enableNotifications
                }
            ]);
            
            this.settings.enableNotifications = value;
        } else if (notificationSetting === 'notificationSound') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: 'Enable notification sounds?',
                    default: this.settings.notificationSound
                }
            ]);
            
            this.settings.notificationSound = value;
        } else if (notificationSetting === 'notificationTypes') {
            console.log(chalk[this.theme.info]('\nNotification Types'));
            console.log(chalk[this.theme.secondary]('Select which events trigger notifications:\n'));
            
            const choices = [
                { name: 'Search Complete', checked: true },
                { name: 'Download Started', checked: true },
                { name: 'Download Complete', checked: true },
                { name: 'Error Notifications', checked: true }
            ];
            
            console.log(chalk[this.theme.secondary]('This feature will be expanded in a future update.'));
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${notificationSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
    async customizePerformanceSettings() {
        console.log(chalk[this.theme.info]('\n📝 Customize Performance Settings'));
        console.log(chalk[this.theme.secondary]('Configure application performance and caching.\n'));
        
        const { performanceSetting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'performanceSetting',
                message: 'Select a performance setting to customize:',
                choices: [
                    { name: 'Enable Result Caching', value: 'cacheResults' },
                    { name: 'Cache Duration (minutes)', value: 'cacheDuration' },
                    { name: 'Auto-Save Search History', value: 'autoSaveSearchHistory' },
                    { name: 'Max Search History Items', value: 'maxSearchHistory' },
                    { name: '← Back to Settings Menu', value: 'back' }
                ],
                loop: true
            }
        ]);
        
        if (performanceSetting === 'back') {
            return;
        }
        
        if (performanceSetting === 'cacheResults' || performanceSetting === 'autoSaveSearchHistory') {
            const { value } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'value',
                    message: `Enable ${performanceSetting === 'cacheResults' ? 'result caching' : 'auto-save search history'}?`,
                    default: this.settings[performanceSetting]
                }
            ]);
            
            this.settings[performanceSetting] = value;
        } else if (performanceSetting === 'cacheDuration') {
            const { value } = await inquirer.prompt([
                {
                    type: 'number',
                    name: 'value',
                    message: 'Enter cache duration in minutes:',
                    default: this.settings.cacheDuration,
                    validate: (input) => {
                        const num = parseInt(input);
                        return (num > 0 && num <= 1440) ? true : 'Please enter a number between 1 and 1440 (24 hours)';
                    }
                }
            ]);
            
            this.settings.cacheDuration = value;
        } else if (performanceSetting === 'maxSearchHistory') {
            const { value } = await inquirer.prompt([
                {
                    type: 'number',
                    name: 'value',
                    message: 'Enter maximum number of search history items to save:',
                    default: this.settings.maxSearchHistory,
                    validate: (input) => {
                        const num = parseInt(input);
                        return (num >= 0 && num <= 100) ? true : 'Please enter a number between 0 and 100';
                    }
                }
            ]);
            
            this.settings.maxSearchHistory = value;
        }
        
        // Save the updated configuration
        this.saveConfig(this.baseUrl, axios.defaults.headers.common['X-Api-Key'], this.qbittorrentUrl);
        console.log(chalk[this.theme.success](`✓ ${performanceSetting} updated successfully`));
        
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }
}

new ProwlingClient().initialize().catch(console.error);