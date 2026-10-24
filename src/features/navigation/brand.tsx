import Image from 'next/image';

export function Brand() {
  return <Image src="/brand/lockup.webp" alt="拾物馆 · MEMORIES MUSEUM" width={1080} height={320} className="museum-brand" />;
}

export function BrandIcon() {
  return <Image src="/brand/logo.png" alt="" width={36} height={36} className="h-9 w-9" />;
}
