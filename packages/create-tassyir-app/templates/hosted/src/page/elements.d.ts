// JSX for the @tassyir/ui elements this page uses (its README lists every
// element's attributes). React 19 sets a custom element's properties and
// attributes as given, and its events bubble to React's own handlers.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type Element<Attributes = object> = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> &
  Attributes;

/** A `<tsy-text-field>`: its value is a property. */
export interface TextFieldElement extends HTMLElement {
  value: string;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'tsy-banner': Element<{
        tone?: 'info' | 'success' | 'warning' | 'critical';
      }>;
      'tsy-button': Element<{
        variant?: 'primary' | 'outline' | 'ghost' | 'destructive';
        size?: 'sm' | 'md' | 'lg';
      }>;
      'tsy-card': Element<{ heading?: string }>;
      'tsy-empty-state': Element<{ heading?: string }>;
      'tsy-skeleton': Element<{ lines?: string }>;
      'tsy-status-pill': Element<{ tone?: string }>;
      'tsy-table': Element<{ heading?: string; count?: string }>;
      'tsy-text-field': DetailedHTMLProps<
        HTMLAttributes<TextFieldElement>,
        TextFieldElement
      > & {
        label?: string;
        hint?: string;
        error?: string;
        value?: string;
        autocomplete?: string;
      };
    }
  }
}
