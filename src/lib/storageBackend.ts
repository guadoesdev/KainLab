export type StorageProvider = 'supabase' | 'firestore';

let providerPromise: Promise<StorageProvider> | null = null;

export async function getStorageProvider(): Promise<StorageProvider> {
  if (!providerPromise) {
    providerPromise = fetch('/api/config/storage')
      .then(async (res) => {
        if (!res.ok) return 'firestore' as const;
        const data = (await res.json().catch(() => ({}))) as { provider?: string };
        return data.provider === 'supabase' ? 'supabase' : 'firestore';
      })
      .catch(() => 'firestore' as const);
  }
  return providerPromise;
}
