// The dashboard answers only requests addressed to this computer's loopback
// name and port. A page on another site may link to the dashboard, never read its data.
export function allowedLocalRequest({method,headers,url},port=5601) {
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(headers.host))return false;
  if(headers['sec-fetch-site']!=='cross-site')return true;
  return ['GET','HEAD'].includes(method) &&
    headers['sec-fetch-mode']==='navigate' &&
    headers['sec-fetch-dest']==='document' &&
    typeof url==='string' && (url==='/' || url.startsWith('/?') || url.startsWith('/#'));
}
