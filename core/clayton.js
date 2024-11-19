const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ClaytonService {
    constructor() {
        this.baseUrl = 'https://tonclayton.fun';
        this.apiBaseId = null;
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Origin": "https://tonclayton.fun",
            "Referer": "https://tonclayton.fun/"
        };
        this.initData = null;
        this.wallet = null;
        this.proxy = null;
    }

    encodeInitData(initData) {
        try {
            // Remove any whitespace and newlines
            initData = initData.trim().replace(/\s+/g, '');
            
            // Convert special characters to their URL-encoded equivalents
            const encoded = initData
                .replace(/"/g, '%22')
                .replace(/'/g, '%27')
                .replace(/\(/g, '%28')
                .replace(/\)/g, '%29')
                .replace(/</g, '%3C')
                .replace(/>/g, '%3E')
                .replace(/\\/g, '%5C')
                .replace(/\{/g, '%7B')
                .replace(/\}/g, '%7D');
            
            return encoded;
        } catch (error) {
            console.error('Error encoding init data:', error);
            return initData;
        }
    }

    async init(initData, wallet, proxy = null) {
        try {
            this.initData = this.encodeInitData(initData);
            this.wallet = wallet;
            this.proxy = proxy;

            await this.fetchApiBaseId();
            const loginResult = await this.login();
            
            if (!loginResult.success) {
                console.error('Login failed:', loginResult.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Init error:', error.message);
            return false;
        }
    }

    async findLatestJsFile() {
        try {
            const config = this.proxy ? { httpsAgent: new HttpsProxyAgent(this.proxy) } : {};
            const response = await axios.get(this.baseUrl, {
                ...config,
                headers: this.headers
            });
            
            const html = response.data;
            const scriptPattern = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/g;
            let latestFile = null;
            let matches;

            while ((matches = scriptPattern.exec(html)) !== null) {
                latestFile = matches[1].split('/').pop();
            }

            return latestFile || 'index-DM0boQba.js';
        } catch (error) {
            return 'index-DM0boQba.js';
        }
    }

    async fetchApiBaseId() {
        try {
            const jsFile = await this.findLatestJsFile();
            const config = this.proxy ? { httpsAgent: new HttpsProxyAgent(this.proxy) } : {};
            
            const response = await axios.get(`${this.baseUrl}/assets/${jsFile}`, {
                ...config,
                headers: {
                    ...this.headers,
                    "Accept": "*/*",
                    "Sec-Fetch-Dest": "script"
                }
            });
            
            const jsContent = response.data;
            const match = jsContent.match(/_ge="([^"]+)"/);
            
            if (!match || !match[1]) {
                return false;
            }

            this.apiBaseId = match[1];
            return true;
        } catch (error) {
            return false;
        }
    }

    async makeRequest(endpoint, method, data = {}) {
        if (!this.apiBaseId) throw new Error('API Base ID not initialized');

        const config = {
            method,
            url: `${this.baseUrl}/api/${this.apiBaseId}/${endpoint}`,
            headers: { 
                ...this.headers,
                "Init-Data": this.initData 
            },
            data
        };

        if (this.proxy) {
            config.httpsAgent = new HttpsProxyAgent(this.proxy);
        }

        try {
            const response = await axios(config);
            return { success: true, data: response.data };
        } catch (error) {
            return { 
                success: false, 
                error: error.message,
                details: error.response?.data
            };
        }
    }

    async login() {
        return this.makeRequest("user/authorization", 'post');
    }

    async connectWallet() {
        if (!this.wallet || !this.wallet.address) {
            return false;
        }

        const result = await this.makeRequest("user/wallet", "post", {
            wallet: this.wallet.address
        });

        return result.success;
    }

    async disconnectWallet() {
        if (!this.wallet || !this.wallet.address) {
            return false;
        }

        const result = await this.makeRequest("user/wallet/disconnect", "post", {
            wallet: this.wallet.address
        });

        return result.success;
    }
}

module.exports = { ClaytonService };
