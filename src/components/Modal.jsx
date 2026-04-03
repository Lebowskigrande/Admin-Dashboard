import { useEffect, useId, useRef } from 'react';
import { FaTimes } from 'react-icons/fa';
import './Modal.css';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

const getFocusableElements = (node) => {
    if (!node) return [];
    return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden) return false;
        if (element.getAttribute('aria-hidden') === 'true') return false;
        return true;
    });
};

const Modal = ({ isOpen, onClose, title, children, className = '' }) => {
    const containerRef = useRef(null);
    const previouslyFocusedRef = useRef(null);
    const titleId = useId();

    useEffect(() => {
        if (!isOpen) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const frame = window.requestAnimationFrame(() => {
            const node = containerRef.current;
            if (!node) return;
            const focusable = getFocusableElements(node);
            (focusable[0] || node).focus();
        });

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            const node = containerRef.current;
            if (!node) return;

            const focusable = getFocusableElements(node);
            if (!focusable.length) {
                event.preventDefault();
                node.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const activeElement = document.activeElement;

            if (event.shiftKey && activeElement === first) {
                event.preventDefault();
                last.focus();
                return;
            }

            if (!event.shiftKey && activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocusedRef.current?.focus?.();
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={containerRef}
                className={`modal-container ${className}`.trim()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 id={titleId}>{title}</h3>
                    <button type="button" className="btn-close" onClick={onClose} aria-label="Close dialog">
                        <FaTimes />
                    </button>
                </div>
                <div className="modal-content">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
