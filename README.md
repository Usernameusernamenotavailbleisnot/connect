# Wallet Connector

This project provides a command-line interface (CLI) tool for connecting and interacting with various blockchain platforms and their associated wallets. It supports multiple wallet versions and platforms, including Blum, YesCoin, Tsubasa, PAWS, SeedDAO, Clayton, And Not Pixel

## Features

- Connect and disconnect wallets for supported platforms
- Display wallet information (seed phrase, address, balance)
- Supports Wallet Contract V3R2, V4, and V5R1
- Asynchronous processing of multiple wallets
- Configurable delay between wallet operations
- Error handling and detailed logging

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node.js package manager)

## Installation

1. Clone the repository:
```
git clone https://github.com/Usernameusernamenotavailbleisnot/connect.git
```

2. Navigate to the project directory:
```
cd connect
```

3. Install the dependencies:
```
npm install
```

## Usage

1. Prepare the necessary data files:
   - `seed.txt`: Contains the seed phrases for the wallets you want to connect.
   - `query.txt`: Contains the query IDs corresponding to each wallet seed phrase.
   - `wallet.txt`: Contains the wallet addresses for PAWS and Clayton platforms.

2. Run the main script:
```
node bot.js
```

3. Follow the on-screen prompts to:
   - Select the platform you want to use
   - Select the wallet version (if applicable)
   - Choose an action (connect, disconnect, or display wallets)

4. The script will process the wallets and display the results, including success/failure counts and total balance (for Blum platform).

## Supported Platforms

The wallet connector currently supports the following platforms:

- Blum
- YesCoin
- Tsubasa
- PAWS
- SeedDAO
- Clayton
- Not Pixel

## Contribution

If you find any issues or have suggestions for improvements, please feel free to create a new issue or submit a pull request.
