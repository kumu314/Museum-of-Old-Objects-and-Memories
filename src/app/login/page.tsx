import { LoginForm } from '../../features/studio/login-form';
import { loginDestination } from '../../features/studio/login-destination';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return <LoginForm returnTo={loginDestination((await searchParams).next)} />;
}
