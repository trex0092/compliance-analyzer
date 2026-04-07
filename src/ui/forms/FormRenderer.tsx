/**
 * FormRenderer — Generic compliance form renderer
 *
 * Renders any ComplianceTemplate into a usable form with:
 * - All field types (text, textarea, select, date, number, checkbox, file)
 * - Required field validation
 * - Regulatory basis display
 * - Approval requirements display
 */

import { useState } from 'react';
import type { ComplianceTemplate, FormField } from '../../domain/complianceTemplates';
import { sanitizeText } from '../../utils/sanitize';

interface FormRendererProps {
  template: ComplianceTemplate;
  initialValues?: Record<string, string | boolean>;
  onSubmit: (values: Record<string, string | boolean>) => void;
  onCancel?: () => void;
  readOnly?: boolean;
}

export function FormRenderer({
  template,
  initialValues = {},
  onSubmit,
  onCancel,
  readOnly = false,
}: FormRendererProps) {
  // Sanitize initialValues on mount to prevent XSS from untrusted sources
  const sanitizedInitial = Object.fromEntries(
    Object.entries(initialValues).map(([k, v]) => [k, typeof v === 'string' ? sanitizeText(v) : v])
  );
  const [values, setValues] = useState<Record<string, string | boolean>>(sanitizedInitial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const SAFE_INPUT_TYPES = ['text', 'textarea', 'select', 'date', 'number', 'checkbox', 'file'];

  function handleChange(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    for (const field of template.fields) {
      if (field.required) {
        const val = values[field.name];
        if (val === undefined || val === '' || val === false) {
          newErrors[field.name] = `${field.label} is required`;
        }
      }
      // Sanitize text inputs
      if (typeof values[field.name] === 'string') {
        values[field.name] = sanitizeText(values[field.name] as string);
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) {
      onSubmit(values);
    }
  }

  function renderField(field: FormField) {
    const value = values[field.name] ?? '';
    const error = errors[field.name];
    const baseStyle: React.CSSProperties = {
      width: '100%',
      padding: '8px 12px',
      border: error ? '1px solid #D94F4F' : '1px solid #333',
      borderRadius: '4px',
      background: '#1a1a2e',
      color: '#e0e0e0',
      fontSize: '13px',
      fontFamily: "'Montserrat', sans-serif",
    };

    let input: React.ReactNode;

    switch (field.type) {
      case 'textarea':
        input = (
          <textarea
            value={value as string}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            disabled={readOnly}
            rows={4}
            style={baseStyle}
          />
        );
        break;
      case 'select':
        input = (
          <select
            value={value as string}
            onChange={(e) => handleChange(field.name, e.target.value)}
            disabled={readOnly}
            style={baseStyle}
          >
            <option value="">— Select —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
        break;
      case 'checkbox':
        input = (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!values[field.name]}
              onChange={(e) => handleChange(field.name, e.target.checked)}
              disabled={readOnly}
            />
            {field.label}
          </label>
        );
        break;
      case 'file':
        input = (
          <input
            type="file"
            onChange={(e) => handleChange(field.name, e.target.files?.[0]?.name || '')}
            disabled={readOnly}
            style={baseStyle}
          />
        );
        break;
      default:
        input = (
          <input
            type={SAFE_INPUT_TYPES.includes(field.type) ? field.type : 'text'}
            value={value as string}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            disabled={readOnly}
            style={baseStyle}
          />
        );
    }

    return (
      <div key={field.name} style={{ marginBottom: '12px' }}>
        {field.type !== 'checkbox' && (
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              marginBottom: '4px',
              color: '#b0b0b0',
            }}
          >
            {field.label} {field.required && <span style={{ color: '#D94F4F' }}>*</span>}
          </label>
        )}
        {input}
        {field.helpText && (
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{field.helpText}</div>
        )}
        {error && (
          <div style={{ fontSize: '11px', color: '#D94F4F', marginTop: '2px' }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        style={{
          marginBottom: '16px',
          padding: '12px',
          background: '#0f0f23',
          borderRadius: '6px',
          border: '1px solid #2a2a4a',
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#e0e0e0' }}>{template.name}</h3>
        <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#888' }}>{template.description}</p>
        <div style={{ fontSize: '11px', color: '#666' }}>
          <strong>Regulatory Basis:</strong> {template.regulatoryBasis}
        </div>
        <div style={{ fontSize: '11px', color: '#666' }}>
          <strong>Approval Required:</strong> {template.approvalRequired.join(', ')}
        </div>
        <div style={{ fontSize: '11px', color: '#666' }}>
          <strong>Retention:</strong> {template.retentionYears} years (FDL Art.24)
        </div>
      </div>

      {template.fields.map(renderField)}

      {!readOnly && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            type="submit"
            style={{
              padding: '8px 20px',
              background: '#3DA876',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Submit
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 20px',
                background: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
}
