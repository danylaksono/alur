import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || 'panel'}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-full bg-slate-50 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mb-3" />
          <div className="text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider">
            {this.props.name || 'Panel'} Error
          </div>
          <div className="text-[11px] text-slate-500 mb-4 max-w-xs font-mono">
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
