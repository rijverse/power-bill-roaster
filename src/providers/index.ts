import { DescoProvider } from './desco';
import { Provider } from './types';

const providers: Record<string, Provider> = {
  desco: new DescoProvider(),
};

export function getProvider(name: string): Provider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export * from './types';
export { DescoProvider } from './desco';
