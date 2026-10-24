import RegisterClient from './register-client';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RegisterClient token={token} />;
}
