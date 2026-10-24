const router = { push: (url: string) => { location.href = url; }, replace: (url: string) => { location.replace(url); } };
export function useRouter() { return router; }
