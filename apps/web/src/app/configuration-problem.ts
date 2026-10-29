/**
 * Screen for a deployment whose environment variables are missing or invalid. It is meant for the
 * person deploying the application, so it lists the exact problems. It is built with plain DOM
 * calls because nothing else of the application can be trusted to start in this state.
 */
export function renderConfigurationProblem(
  container: HTMLElement,
  issues: readonly string[],
): void {
  const wrapper = document.createElement('main');
  wrapper.style.cssText =
    'max-width:40rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#161d1b';

  const heading = document.createElement('h1');
  heading.textContent = 'Agla Kadam is not configured';
  heading.style.cssText = 'font-size:1.5rem;margin:0 0 0.5rem';

  const intro = document.createElement('p');
  intro.textContent =
    'The application cannot start because its configuration is incomplete. Set the following ' +
    'environment variables for this deployment and build it again:';

  const list = document.createElement('ul');
  for (const issue of issues) {
    const item = document.createElement('li');
    item.textContent = issue;
    list.append(item);
  }

  wrapper.append(heading, intro, list);
  container.replaceChildren(wrapper);
}
