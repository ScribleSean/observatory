export function allowedLocalRequest({method,headers,url}) {
  if (!['127.0.0.1:5601','localhost:5601'].includes(headers.host)) return false;
  if (headers['sec-fetch-site'] !== 'cross-site') return true;
  return ['GET','HEAD'].includes(method) &&
    headers['sec-fetch-mode'] === 'navigate' &&
    headers['sec-fetch-dest'] === 'document' &&
    typeof url === 'string' && (url === '/' || url.startsWith('/?'));
}
