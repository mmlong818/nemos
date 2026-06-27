// Routes Node's global fetch through HTTPS_PROXY/HTTP_PROXY (undici ignores them by default).
import { setGlobalDispatcher, ProxyAgent } from 'undici';

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxy, connectTimeout: 30_000 }));
  console.error(`[proxy-boot] fetch via ${proxy}`);
}
