const axios = require('axios');

class PawsService {
    constructor() {
        this.baseUrl = 'https://api.paws.community/v1';
        this.token = null;
        this.wallet = null;
        this.referralCode = 'ss0WegUb';
    }

    async login(queryText) {
        try {
            const payload = {
                data: queryText,
                referralCode: this.referralCode
            };

            const response = await axios.post(
                `${this.baseUrl}/user/auth`,
                payload,
                { headers: this.getHeaders() }
            );

            if (response.data?.success && Array.isArray(response.data.data) && response.data.data[0]) {
                this.token = response.data.data[0];
                return this.token;
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    async init(token, wallet) {
        try {
            this.token = token;
            this.wallet = wallet?.address;
            
            if (!this.token || !this.wallet) {
                throw new Error('Token or wallet missing after initialization');
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    getHeaders(includeAuth = false) {
        const headers = {
            'accept': 'application/json',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            'origin': 'https://app.paws.community',
            'priority': 'u=1, i',
            'referer': 'https://app.paws.community/',
            'sec-ch-ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
        };

        if (includeAuth && this.token) {
            headers['authorization'] = `Bearer ${this.token}`;
        }

        return headers;
    }

    async connectWallet() {
        try {
            if (!this.token || !this.wallet) {
                return false;
            }

            const response = await axios.post(
                `${this.baseUrl}/user/wallet`,
                { wallet: this.wallet },
                { 
                    headers: {
                        'accept': 'application/json',
                        'accept-encoding': 'gzip, deflate, br, zstd',
                        'accept-language': 'en-US,en;q=0.9',
                        'content-type': 'application/json',
                        'authorization': `Bearer ${this.token}`,
                        'origin': 'https://app.paws.community',
                        'priority': 'u=1, i',
                        'referer': 'https://app.paws.community/',
                        'sec-ch-ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-site',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
                    }
                }
            );

            return response.data?.success || false;
        } catch (error) {
            return false;
        }
    }

    async disconnectWallet() {
        try {
            if (!this.token) {
                return false;
            }

            const response = await axios.post(
                `${this.baseUrl}/user/wallet`,
                { wallet: "" },
                { 
                    headers: {
                        'accept': 'application/json',
                        'accept-encoding': 'gzip, deflate, br, zstd',
                        'accept-language': 'en-US,en;q=0.9',
                        'content-type': 'application/json',
                        'authorization': `Bearer ${this.token}`,
                        'origin': 'https://app.paws.community',
                        'priority': 'u=1, i',
                        'referer': 'https://app.paws.community/',
                        'sec-ch-ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-site',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
                    }
                }
            );

            return response.data?.success || false;
        } catch (error) {
            return false;
        }
    }
}

module.exports = { PawsService };
