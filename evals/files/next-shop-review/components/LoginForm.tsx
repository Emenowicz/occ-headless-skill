'use client';
import { useState } from 'react';

export function LoginForm() {
  const [error, setError] = useState('');
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch(`${process.env.NEXT_PUBLIC_OCC_HOST}/authorizationserver/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: String(form.get('email')),
        password: String(form.get('password')),
        client_id: process.env.NEXT_PUBLIC_OCC_CLIENT_ID!,
        client_secret: process.env.NEXT_PUBLIC_OCC_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) return setError('Login failed');
    const token = await res.json();
    localStorage.setItem('token', token.access_token);
    location.href = '/';
  }
  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      <button type="submit">Sign in</button>
      {error && <p>{error}</p>}
    </form>
  );
}
