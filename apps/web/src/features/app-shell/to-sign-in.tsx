import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/**
 * Sends a person whose session has ended to the sign-in page, once, with the application page
 * they were on to return to.
 *
 * The router's `<Navigate>` navigates again on every render. The layout renders again while the
 * sign-in page loads, with the location already changed to it, so the page to return to would
 * wrap the sign-in address inside itself again and again until the tab ran out of memory. The
 * address is therefore taken once, and only when it is a page of the application.
 */
export function ToSignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [redirect] = useState(() =>
    location.pathname.startsWith('/app') ? location.href : undefined,
  );
  useEffect(() => {
    void navigate({ to: '/login', search: redirect ? { redirect } : {}, replace: true });
  }, [navigate, redirect]);
  return null;
}
