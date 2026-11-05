import {
  LayoutDashboard,
  UserPlus,
  Settings,
  Globe,
  Network,
  Zap,
  Server,
  KeyRound,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type PageId =
  | 'dashboard'
  | 'create-ssh'
  | 'set-ssh'
  | 'set-v2ray'
  | 'set-cfip'
  | 'generator';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  isPassConfigured: boolean;
  onChangePass: () => void;
}

const menuItems: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create-ssh', label: 'Buat Akun SSH', icon: UserPlus },
  { id: 'set-ssh', label: 'Pengaturan SSH', icon: Settings },
  { id: 'set-v2ray', label: 'Pengaturan V2Ray', icon: Network },
  { id: 'set-cfip', label: 'Pengaturan CFIP', icon: Globe },
  { id: 'generator', label: 'Config Generator', icon: Zap },
];

export function Sidebar({
  currentPage,
  onNavigate,
  open,
  onClose,
  isAdmin,
  isPassConfigured,
  onChangePass,
}: SidebarProps) {
  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 bg-neutral-10/40 z-[998] transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-72 bg-surface-container-lowest border-r border-neutral-90/50 z-[999] flex flex-col transition-transform duration-300 ease-out',
          'lg:translate-x-0 lg:static lg:z-auto lg:shadow-none shadow-xl',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-neutral-90/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-m3-sm bg-primary-40 text-primary-100">
              <Server size={18} />
            </div>
            <span className="text-sm font-bold text-neutral-10">Navigation</span>
          </div>
          <button
            onClick={onClose}
            className="m3-btn-text state-layer p-2 rounded-m3-full text-neutral-50 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = currentPage === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      'state-layer w-full flex items-center gap-3 rounded-m3-full px-4 py-3 text-sm font-medium transition-all duration-200',
                      active
                        ? 'bg-primary-95 text-primary-30 font-semibold'
                        : 'text-neutral-30 hover:bg-neutral-95/60'
                    )}
                  >
                    <Icon size={20} className={active ? 'text-primary-40' : ''} />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="border-t border-neutral-90/40 p-3">
          <div
            className={cn(
              'm3-chip mb-2',
              isAdmin
                ? 'bg-primary-90 text-primary-20'
                : 'bg-neutral-90 text-neutral-30'
            )}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                isAdmin ? 'bg-primary-50' : 'bg-neutral-50'
              )}
            />
            {isPassConfigured
              ? isAdmin
                ? 'Admin Route Active'
                : 'Public Creation'
              : 'Not Configured'}
          </div>
          {isAdmin && isPassConfigured && (
            <button
              onClick={onChangePass}
              className="m3-btn m3-btn-text state-layer w-full justify-start text-xs text-primary-50"
            >
              <KeyRound size={14} /> Ganti Password Admin
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
