import { useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import './Modal.css';

const Modal = ({ isOpen, onClose, title, children, className = '' }) => {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className={`modal-container ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="btn-close" onClick={onClose}>
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
