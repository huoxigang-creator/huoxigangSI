function retired(request: Request) {
  if (!request.headers.get('oai-authenticated-user-id')) return Response.json({error: '请先登录'}, {status: 401});
  return Response.json({error: '旧五金功能已停用。项目附件请使用文件上传；历史五金资料可在资料页的回收站恢复。'}, {status: 410, headers: {'Cache-Control': 'private, no-store'}});
}
export const GET = retired;
export const POST = retired;
