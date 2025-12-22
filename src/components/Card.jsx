import './Card.css';

const Card = ({ title, children, className = '', footer }) => {
    return (
        <div className={`card ${className}`}>
            {title && <div className="card-header"><h3>{title}</h3></div>}
            <div className="card-body">
                {children}
            </div>
            {footer && <div className="card-footer">{footer}</div>}
        </div>
    );
};

export default Card;
