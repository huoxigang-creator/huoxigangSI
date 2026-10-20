import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {canManageSite,customerRoute} from '../lib/management-access';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url=new URL(request.url),path=url.pathname;
    const assets=(request.method==='GET'||request.method==='HEAD')&&(path.startsWith('/_next/')||path.startsWith('/assets/')||/^\/(favicon|window|globe|file)\.svg$/.test(path));
    const identity=request.headers.get('oai-authenticated-user-id');
    if(path==='/mcp'&&identity&&!canManageSite(identity,import.meta.env.DEV))return Response.json({error:'无权访问管理后台'},{status:403,headers:{'Cache-Control':'private, no-store'}});
    // MCP discovery contains no business data; its tools/call handler checks identity.
    if(path!=='/mcp'&&!assets&&!customerRoute(path,request.method)&&!canManageSite(identity,import.meta.env.DEV)){
      const responseHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
      if(path.startsWith('/api/'))return Response.json({error:identity?'无权访问管理后台':'请先登录'},{status:identity?403:401,headers:responseHeaders});
      if(!identity)return Response.redirect(url.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(path+url.search),302);
      return new Response('无权访问管理后台',{status:403,headers:responseHeaders});
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
