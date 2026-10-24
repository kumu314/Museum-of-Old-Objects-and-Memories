import { createElement, type ImgHTMLAttributes } from 'react';
export default function Image({ unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  void _unoptimized;
  return createElement('img', props);
}
