import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/format'

export type ButtonVariant = 'default' | 'primary' | 'accent' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: '',
  primary: 'btn-primary',
  accent: 'btn-accent',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  // `min-h-9` keeps even the secondary controls a usable touch target on a
  // phone; the play board is explicitly meant to be playable on mobile web.
  sm: 'min-h-9 px-2.5 py-1.5 text-xs',
  md: 'min-h-10',
  lg: 'min-h-12 px-5 py-2.5 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * A real `<button>` so keyboard activation, focus rings and screen-reader
 * semantics come for free. The board is fully playable with Tab + Enter.
 */
export function Button({ variant = 'default', size = 'md', className, type, ...rest }: ButtonProps) {
  return (
    <button type={type ?? 'button'} className={cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className)} {...rest} />
  )
}
