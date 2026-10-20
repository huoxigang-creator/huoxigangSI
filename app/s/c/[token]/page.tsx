import ConfirmClient from './confirm-client';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConfirmClient token={token}/>;
}
