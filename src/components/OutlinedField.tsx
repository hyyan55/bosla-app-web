import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface OutlinedFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  error?: string;
  icon?: React.ReactNode;
  dir?: 'rtl' | 'ltr';
  autoComplete?: string;
}

export function OutlinedField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  icon,
  dir = 'rtl',
  autoComplete,
}: OutlinedFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const actualType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="w-full">
      <label
        htmlFor={id}
        className="block text-xs font-bold text-[#101D35] mb-1.5 pr-1"
      >
        {label}
      </label>
      <div
        className={`relative flex items-center rounded-xl border bg-white transition-colors ${
          error
            ? 'border-red-500 ring-1 ring-red-500/20'
            : 'border-slate-300 focus-within:border-[#2878E8] focus-within:ring-2 focus-within:ring-[#2878E8]/15'
        }`}
      >
        {icon && (
          <div className="pr-3.5 pl-1 text-slate-400 shrink-0 flex items-center">
            {icon}
          </div>
        )}
        <input
          id={id}
          type={actualType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={dir}
          autoComplete={autoComplete}
          className={`w-full min-h-[48px] bg-transparent py-2.5 text-sm text-[#101D35] placeholder:text-slate-400 focus:outline-none ${
            icon ? 'pr-2' : 'pr-3.5'
          } ${isPassword ? 'pl-11' : 'pl-3.5'} ${dir === 'ltr' ? 'text-left' : 'text-right'}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            className="absolute left-1 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-[#101D35] rounded-lg"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-red-600 pr-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
