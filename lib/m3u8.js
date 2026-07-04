const axios = require('axios');

class M3U8ToMP4Converter {
    constructor() {
        this.baseUrl = 'https://m3u8-to-mp4.com';
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': this.baseUrl,
                'Referer': this.baseUrl + '/'
            }
        });
        this.sessionId = null;
    }

    getDateNow() {
        return new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    }

    async createJob(m3u8Url) {
        try {
            const filename = `Tiyanz-api-${this.getDateNow()}`;
            const payload = {
                url: m3u8Url,
                filename: filename,
                format: 'mp4'
            };

            const response = await this.client.post('/api/jobs', payload);
            const data = response.data;

            if (data.sessionId) {
                this.sessionId = data.sessionId;
                this.client.defaults.headers['Cookie'] = `sessionId=${this.sessionId}`;
            }

            return data.id;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async checkJobStatus(jobId) {
        try {
            const response = await this.client.get('/api/jobs');
            const jobs = response.data;
            const currentJob = jobs.find(j => j.id === jobId);

            if (!currentJob) return { status: 'missing' };
            
            if (currentJob.status === 'completed') {
                return {
                    status: 'completed',
                    id: jobId,
                    filename: currentJob.filename,
                    downloadUrl: `${this.baseUrl}/api/jobs/${jobId}/download`,
                    info: currentJob
                };
            }

            if (currentJob.status === 'error') return { status: 'error' };

            return { status: currentJob.status || 'processing' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }
}

module.exports = M3U8ToMP4Converter;