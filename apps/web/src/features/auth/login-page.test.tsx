import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import { renderRoute } from '@/test/render-route';

describe('sign-in page', () => {
  it('sends a visitor who is not signed in from the application to the sign-in page', async () => {
    renderRoute('/app/admin');
    expect(
      await screen.findByRole('heading', { level: 1, name: en.auth.title }),
    ).toBeInTheDocument();
  });

  it('asks for both fields before contacting the server', async () => {
    renderRoute('/login');
    await userEvent.click(await screen.findByRole('button', { name: en.common.signIn }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.errors.missingFields);
  });

  it('rejects a mobile number that is not ten digits', async () => {
    renderRoute('/login');
    await userEvent.type(await screen.findByLabelText(en.auth.staff.identifierLabel), '12345');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: en.common.signIn }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.errors.invalidMobile);
  });

  it('lets the main administrator switch to an email address with a suitable keyboard', async () => {
    renderRoute('/login');
    const mobile = await screen.findByLabelText(en.auth.staff.identifierLabel);
    expect(mobile).toHaveAttribute('inputmode', 'tel');
    await userEvent.type(mobile, '98765');
    await userEvent.click(screen.getByRole('button', { name: en.auth.staff.useEmail }));

    const email = screen.getByLabelText(en.auth.staff.emailLabel);
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveValue('');
    await userEvent.type(email, 'admin@example');
    await userEvent.type(screen.getByLabelText(en.auth.passwordLabel), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: en.common.signIn }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.errors.invalidEmail);

    await userEvent.click(screen.getByRole('button', { name: en.auth.staff.useMobile }));
    expect(screen.getByLabelText(en.auth.staff.identifierLabel)).toHaveValue('');
  });

  it('offers a separate sign-in for families with code and PIN checks', async () => {
    renderRoute('/login');
    await userEvent.click(await screen.findByRole('tab', { name: en.auth.tabs.family }));
    expect(screen.getByRole('tab', { name: en.auth.tabs.family })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.type(screen.getByLabelText(en.auth.family.learnerCodeLabel), '12345 67897');
    const pin = screen.getByLabelText(en.auth.family.pinLabel);
    await userEvent.type(pin, '12ab3');
    // Only digits are kept in the PIN field.
    expect(pin).toHaveValue('123');
    await userEvent.click(screen.getByRole('button', { name: en.common.signIn }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(en.auth.errors.invalidPin);
    });
  });

  it('lets people show the password they typed', async () => {
    renderRoute('/login');
    const password = await screen.findByLabelText(en.auth.passwordLabel);
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: en.form.showPassword }));
    expect(password).toHaveAttribute('type', 'text');
  });
});
