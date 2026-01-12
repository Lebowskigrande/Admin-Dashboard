import './Card.css';

const Card = ({ title, children, className = '', footer, style, ...props }) => {
    return (
        <div className={`card ${className}`} style={style} {...props}>
            {title && <div className="card-header"><h3>{title}</h3></div>}
            <div className="card-body">
                {children}
            </div>
            {footer && <div className="card-footer">{footer}</div>}
        </div>
    );
};

export default Card;
