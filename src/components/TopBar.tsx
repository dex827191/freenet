import { Menu, ShieldCheck, ShieldAlert, LogOut, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onToggleSidebar: () => void;
  isAdmin: boolean;
  isPassConfigured: boolean;
  onAdminAction: () => void;
  onChangePass: () => void;
  showChangePass: boolean;
}

export function TopBar({
  onToggleSidebar,
  isAdmin,
  isPassConfigured,
  onAdminAction,
  onChangePass,
  showChangePass,
}: TopBarProps) {
  const buttonText = !isPassConfigured
    ? 'SETUP PASS'
    : isAdmin
      ? 'LOGOUT'
      : 'LOGIN ADMIN';

  const btnClass = !isPassConfigured
    ? 'bg-neutral-95 text-neutral-30 hover:bg-neutral-90'
    : isAdmin
      ? 'bg-error-90 text-error-30 hover:bg-error-80'
      : 'bg-neutral-95 text-neutral-30 hover:bg-neutral-90';

  return (
    <header className="sticky top-0 z-[100] bg-surface-container-lowest/95 backdrop-blur-md border-b border-neutral-90/50 shadow-sm">
      <div className="flex items-center justify-between px-4 h-16">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="m3-btn-text state-layer p-2 rounded-m3-full text-neutral-30 lg:hidden"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-m3-md bg-primary-40 text-primary-100 shadow-sm">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-neutral-10 leading-tight">
                SERVER PANEL
              </h1>
              <span
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide',
                  isAdmin ? 'text-primary-50' : 'text-neutral-50'
                )}
              >
                {isAdmin ? 'Admin Mode' : 'Public Access'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showChangePass && isAdmin && (
            <button
              onClick={onChangePass}
              className="m3-btn m3-btn-text state-layer text-xs text-primary-50"
            >
              <KeyRound size={14} /> Ganti Pass
            </button>
          )}
          <button
            onClick={onAdminAction}
            className={cn(
              'm3-btn state-layer rounded-m3-full px-4 py-2 text-xs font-bold transition-all',
              btnClass
            )}
          >
            {isAdmin ? <LogOut size={14} /> : <ShieldAlert size={14} />}
            {buttonText}
          </button>
        </div>
      </div>
    </header>
  );
}
