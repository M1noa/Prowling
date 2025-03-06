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
        this.downloadClient = null;
        this.configPath = path.join(__dirname, 'config.json');
        this.currentMenuLevel = 'main'; // Track current menu level
        
        // Handle Ctrl+C to navigate back one level instead of exiting immediately
        process.on('SIGINT', () => {
            if (this.currentMenuLevel === 'main') {
                console.log(chalk.yellow('\nGoodbye! ⚐\n'));
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
                return config;
            }
        } catch (error) {
            console.log(chalk.yellow('Could not load config file. Using default settings.'));
        }
        return { serverUrl: '', apiKey: '' };
    }

    saveConfig(serverUrl, apiKey) {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify({ serverUrl, apiKey }, null, 4));
            console.log(chalk.green('✓ Configuration saved'));
        } catch (error) {
            console.log(chalk.red(`Failed to save configuration: ${error.message}`));
        }
    }

    async initialize() {
        // Load existing config
        const savedConfig = this.loadConfig();
        
        // Custom prompt theme for better UI
        inquirer.registerPrompt('chalk-pipe', require('inquirer-chalk-pipe'));
        
        const { serverUrl, apiKey } = await inquirer.prompt([
            {
                type: 'input',
                name: 'serverUrl',
                message: 'Enter Prowlarr server URL (e.g. http://localhost:9696):',
                default: savedConfig.serverUrl,
                validate: (input) => input.startsWith('http') || 'URL must start with http:// or https://',
                prefix: chalk.cyan('⊡'),
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'Enter your Prowlarr API key:',
                default: savedConfig.apiKey,
                validate: (input) => input.length > 0 || 'API key cannot be empty',
                prefix: chalk.cyan('⚿'),
            }
        ]);

        // Save the config for future use
        this.saveConfig(serverUrl, apiKey);

        this.baseUrl = serverUrl;
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

            // Fetch download client
            spinner.start('Fetching download client...');
            const { data: downloadClients } = await axios.get(`${this.baseUrl}/api/v1/downloadclient`);
            this.downloadClient = downloadClients[0];
            spinner.succeed(chalk.green('Download client configured'));

            await this.startSearchLoop();
        } catch (error) {
            spinner.fail(chalk.red(`Failed to connect: ${error.message}`));
            process.exit(1);
        }
    }

    async startSearchLoop() {
        console.log(chalk.cyan('\n┌─────────────────────────────────────────┐'));
        console.log(chalk.cyan('│') + chalk.bold.white(' ⚲ Prowling - Prowlarr Search Client     ') + chalk.cyan('│'));
        console.log(chalk.cyan('└─────────────────────────────────────────┘\n'));
        
        // Navigation stack to keep track of where we are
        const navigationStack = [];
        
        while (true) {
            this.currentMenuLevel = 'main';
            
            const { category } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'category',
                    message: 'Select a category to search:',
                    prefix: chalk.magenta('⚇'),
                    choices: [
                        { name: '⚓ Movies (Radarr)', value: 2000 },
                        { name: '⚔ TV Shows (Sonarr)', value: 5000 },
                        { name: '⚠ Adult (Whisparr)', value: 6000 },
                        { name: '⊡ All Categories', value: 'all' },
                        { name: '✕ Exit', value: 'exit' }
                    ],
                    loop: true,
                    pageSize: 30
                }
            ]);

            if (category === 'exit') {
                console.log(chalk.yellow('\nGoodbye! ⚐\n'));
                process.exit(0);
            }
            
            const { query } = await inquirer.prompt([{
                type: 'input',
                name: 'query',
                message: `Enter search query for ${category === 'all' ? 'all categories' : category} (or "back" to return):`,
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
                searchParams.categories = [category];
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
                
                const choices = results.map(result => ({
                    name: `${chalk.green(result.title)} ${chalk.dim('|')} ${chalk.blue(result.indexer)} ${chalk.dim('|')} ${chalk.yellow(formatSize(result.size))} ${chalk.dim('|')} ${result.seeders !== undefined && result.seeders !== null ? chalk.green(`⚡${result.seeders}`) : chalk.red('Unknown')}`,
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
                                    name: `${chalk.green(result.title)} ${chalk.dim('|')} ${chalk.blue(result.indexer)} ${chalk.dim('|')} ${chalk.yellow(formatSize(result.size))} ${chalk.dim('|')} ${result.seeders !== undefined && result.seeders !== null ? chalk.green(`⚡${result.seeders}`) : chalk.red('Unknown')}`,
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
                                    { name: 'Date (Oldest First)', value: 'date_asc' }
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
                            console.log(chalk.bold('Category: ') + chalk.magenta(selected.categories?.join(', ') || 'Unknown'));
                            console.log(chalk.bold('Seeders: ') + chalk.green(selected.seeders || 'Unknown'));
                            console.log(chalk.bold('Leechers: ') + chalk.red(selected.leechers || 'Unknown'));
                            console.log(chalk.bold('Published: ') + chalk.white(new Date(selected.publishDate).toLocaleString() || 'Unknown'));
                        
                            // Build choices array dynamically based on available URLs
                            const actionChoices = [];
                            
                            // Only add torrent URL option if it exists
                            if (selected.downloadUrl) {
                                actionChoices.push({ name: '⚟ Copy torrent URL', value: 'download_url' });
                            }
                            
                            // Only add magnet URL option if it exists
                            if (selected.magnetUrl) {
                                actionChoices.push({ name: '⚲ Copy magnet URL', value: 'magnet_url' });
                            }
                            
                            // Always add these options
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

                            if (action === 'download_url') {
                                console.log(chalk.cyan('\nTorrent URL:'));
                                console.log(chalk.white(selected.downloadUrl));
                                console.log(chalk.gray('\nPress Enter to go back...'));
                                await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
                            } else if (action === 'magnet_url') {
                                console.log(chalk.cyan('\nMagnet URL:'));
                                console.log(chalk.white(selected.magnetUrl || 'Not available'));
                                console.log(chalk.gray('\nPress Enter to go back...'));
                                await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
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
                magnetUrl: item.magnetUrl || 'Not available',
                quality: item.quality || 'Not available',
                protocol: item.protocol || 'Not available',
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
}

new ProwlingClient().initialize().catch(console.error);