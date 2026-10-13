import React from 'react';
import type { UltimateInputFieldProps } from '../types';
import { UltimateInputField } from './UltimateInputField';
import { UIFProvider } from './UIFContext';

export interface UltimateBarProps extends UltimateInputFieldProps {
  /** Modules shown left of the input field. */
  left?: React.ReactNode;
  /** Modules shown right of the input field. */
  right?: React.ReactNode;
  /** Anything else that should share the bar's outputs and actions (use `useUIF()`). */
  children?: React.ReactNode;
}

/**
 * A modular bar with the input field at its centre. It owns the shared state
 * (actions, output fields, strings) so modules can reach it through `useUIF()`.
 */
export function UltimateBar({ storageKey, popoutUrl, defaultStrings, modules, outputTop, outputArea, children, ...fieldProps }: UltimateBarProps) {
  return (
    <UIFProvider storageKey={storageKey} popoutUrl={popoutUrl} defaultStrings={defaultStrings} modules={modules} outputTop={outputTop} outputArea={outputArea}>
      <UltimateInputField {...fieldProps} />
      {children}
    </UIFProvider>
  );
}
