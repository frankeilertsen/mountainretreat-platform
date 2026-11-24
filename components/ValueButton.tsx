'use client';
import type { ButtonHTMLAttributes } from 'react';

/**
 * A submit button that carries a value (e.g. status="closed").
 * In this Next.js/React version the clicked button's name/value is not always included when a form
 * posts to a server action, so the value is copied into a hidden field of the same name just before
 * the form submits. Without JavaScript the browser sends the button value itself.
 */
export function ValueButton({ name, value, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { name: string; value: string }) {
  return (
    <button
      {...rest}
      type="submit"
      name={name}
      value={value}
      onClick={e => {
        const form = e.currentTarget.form;
        if (form) {
          let h = form.querySelector<HTMLInputElement>(`input[type="hidden"][data-vb="${name}"]`);
          if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = name; h.dataset.vb = name; form.appendChild(h); }
          h.value = value;
          // The form data is collected during this same click; remove the field afterwards so a
          // different button in the same form (e.g. "Lagre") is not sent with this value.
          const field = h;
          setTimeout(() => field.remove(), 0);
        }
        onClick?.(e);
      }}
    />
  );
}
