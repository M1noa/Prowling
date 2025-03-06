# Prowling

[![GitHub](https://img.shields.io/github/license/M1noa/Prowling)](https://github.com/M1noa/Prowling)
[![GitHub stars](https://img.shields.io/github/stars/M1noa/Prowling)](https://github.com/M1noa/Prowling/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/M1noa/Prowling)](https://github.com/M1noa/Prowling/issues)

A simple CLI tool to use prowlerr to search!

## Features

- 🔍 Search across all your Prowlarr indexers from the command line
- 🗂️ Filter searches by category (Movies, TV Shows, etc.)
- ⚡ Sort results by various criteria (size, seeders, date, etc.)
- 🔎 Search within search results
- 📋 Copy torrent and magnet URLs
- 🎨 Beautiful terminal UI with color-coded information

## Installation

### Prerequisites

- Node.js (v12 or higher)
- Git
- A running Prowlarr instance with configured indexers


### Running

```bash
# Clone the repository
git clone https://github.com/M1noa/Prowling.git
cd Prowling

# Install dependencies
npm install

# start
node index.js
```

## Usage

run the start command `node index.js`

On first run, you'll be prompted to enter your Prowlarr server URL and API key. These will be saved for future sessions. (by just hitting enter when it prompts for em)

## Navigation

- Use arrow keys to navigate menus
- Press Enter to select an option
- Press Ctrl+C to go back one level or exit the application

## Contributing

Contributions are welcome and appreciated! Here's how you can contribute:

1. **Fork** the repository on GitHub
2. **Clone** your fork to your local machine
3. **Create a branch** for your feature or bugfix
4. **Commit** your changes
5. **Push** your branch to your fork
6. Submit a **Pull Request** to the main repository


### Guidelines

- Follow the existing code style
- Add comments for complex logic
- Update documentation for any new features
- Write descriptive commit messages

## License

This project is licensed under the MIT License - see the LICENSE file for details.


## TODO

- Finish // fix the "Download with client" option with a default dir saved in the config file and more
- Add more customization // settings
---

[```made with <3 by Minoa```](https://github.com/M1noa)
