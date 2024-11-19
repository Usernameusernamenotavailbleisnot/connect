const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ClaytonService {
    constructor() {
        this.baseUrl = 'https://tonclayton.fun';
        this.apiBaseId = null;
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            "Origin": "https://tonclayton.fun",
            "Referer": "https://tonclayton.fun/games",
            "Sec-Ch-Ua": '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
        };
        this.knownJsFile = 'index-DM0boQba.js';
        this.initData = null;
        this.wallet = null;
        this.proxy = null;
    }

    async init(initData, wallet, proxy = null) {
        try {
            this.initData = initData;
            this.wallet = wallet;
            this.proxy = proxy;

            await this.fetchApiBaseId();
            const loginResult = await this.login();
            
            if (!loginResult.success) {
                console.log("Failed to login to Clayton");
                return false;
            }

            return true;
        } catch (error) {
            console.error("Error initializing Clayton service:", error);
            return false;
        }
    }

    async findLatestJsFile() {
        try {
            const config = this.proxy ? { httpsAgent: new HttpsProxyAgent(this.proxy) } : {};
            const response = await axios.get(this.baseUrl, {
                ...config,
                headers: {
                    ...this.headers,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
                }
            });
            
            const html = response.data;
            const scriptPattern = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/g;
            let latestFile = null;
            let matches;

            while ((matches = scriptPattern.exec(html)) !== null) {
                latestFile = matches[1].split('/').pop();
            }

            return latestFile || this.knownJsFile;
        } catch (error) {
            console.log("Error finding JS file, using default");
            return this.knownJsFile;
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
                throw new Error('API Base ID not found');
            }

            this.apiBaseId = match[1];
            return true;
        } catch (error) {
            console.error("Error fetching API Base ID:", error);
            return false;
        }
    }

    async makeRequest(endpoint, method, data = {}) {
        if (!this.apiBaseId) throw new Error('API Base ID not initialized');

        const config = {
            method,
            url: `${this.baseUrl}/api/${this.apiBaseId}/${endpoint}`,
            headers: { ...this.headers, "Init-Data": this.initData },
            data
        };

        if (this.proxy) {
            config.httpsAgent = new HttpsProxyAgent(this.proxy);
        }

        try {
            const response = await axios(config);
            return { success: true, data: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async login() {
        return this.makeRequest("user/authorization", 'post');
    }

    async connectWallet() {
        if (!this.wallet || !this.wallet.address) {
            console.log("No wallet address provided");
            return false;
        }

        const result = await this.makeRequest("user/wallet", "post", {
            wallet: this.wallet.address
        });

        return result.success;
    }
}

module.exports = { ClaytonService };
