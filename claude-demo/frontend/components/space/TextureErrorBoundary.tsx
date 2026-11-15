"use client";

import { Component, type ReactNode } from "react";

type Props = { fallback: ReactNode; children: ReactNode; name?: string };
type State = { failed: boolean };

// React "error boundary": if anything inside it throws (for example, a
// texture file is missing), show `fallback` instead of breaking the page.
export default class TextureErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      `[SPHEREx Xplorer] ${this.props.name ?? "A texture"} could not be loaded; showing a fallback. ` +
        "Check the files in public/textures/.",
      error,
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
