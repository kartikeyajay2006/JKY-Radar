/** @import { ClassValue } from 'clsx' */
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** @param {...ClassValue} inputs */
export const cn = (...inputs) => twMerge(clsx(inputs));
