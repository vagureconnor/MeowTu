// 高级模式 Worker：只接管 /dl/meowtu.jar（补齐 CheerpJ 必需的 Range 支持），其余请求走静态资源。
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/dl/meowtu.jar') {
      return env.ASSETS.fetch(request);
    }
    const assetRes = await env.ASSETS.fetch(new URL('/meowtu.jar', request.url));
    if (!assetRes.ok) return assetRes;
    const buf = await assetRes.arrayBuffer();
    const total = buf.byteLength;
    const headers = new Headers({
      'Content-Type': 'application/java-archive',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=600',
    });
    const range = request.headers.get('Range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start, end;
        if (m[1] === '' && m[2] !== '') {
          const n = parseInt(m[2], 10);
          start = Math.max(0, total - n); end = total - 1;
        } else {
          start = m[1] === '' ? 0 : parseInt(m[1], 10);
          end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
        }
        if (start <= end && start < total) {
          const slice = buf.slice(start, end + 1);
          headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
          headers.set('Content-Length', String(slice.byteLength));
          return new Response(request.method === 'HEAD' ? null : slice, { status: 206, headers });
        }
      }
      headers.set('Content-Range', 'bytes */' + total);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Length', String(total));
    return new Response(request.method === 'HEAD' ? null : buf, { status: 200, headers });
  },
};
