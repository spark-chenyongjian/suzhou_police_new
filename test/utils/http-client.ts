import { Agent } from 'https';

// Create HTTP client that bypasses proxy for localhost
export async function fetchLocal(url: string, options: RequestInit = {}) {
  // For localhost requests, we need to bypass the system proxy
  // In Node.js environment, we can use the http/https modules directly
  const http = await import('http');
  const https = await import('https');
  const { URL } = await import('url');

  const parsedUrl = new URL(url);
  
  // Use appropriate agent based on protocol
  const isHttps = parsedUrl.protocol === 'https:';
  const AgentClass = isHttps ? https.Agent : http.Agent;
  
  // Create agent that bypasses proxy for localhost
  const agent = new AgentClass({
    rejectUnauthorized: false,
    // Don't use proxy for localhost
    ...(!isHttps && parsedUrl.hostname === 'localhost' ? { 
      // For HTTP localhost, no special config needed
    } : {})
  });

  // Convert fetch options to http/https options
  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? '443' : '80'),
    path: parsedUrl.pathname + parsedUrl.search,
    method: options.method || 'GET',
    headers: options.headers as Record<string, string> || {},
    agent: parsedUrl.hostname === 'localhost' ? undefined : agent
  };

  return new Promise<Response>((resolve, reject) => {
    const req = (isHttps ? https : http).request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          json: async () => JSON.parse(data),
          text: async () => data
        } as Response);
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body as string);
    }
    
    req.end();
  });
}