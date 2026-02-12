import Card from '../../components/Card';
import { API_URL } from '../../services/apiConfig';
import { formatPhone } from '../../utils/formatters';

const BuildingsVendors = ({
    vendors,
    vendorsLoading,
    vendorsError
}) => (
    <Card>
        {vendorsError && <div className="ticket-error">{vendorsError}</div>}
        {vendorsLoading ? (
            <p className="empty-state">Loading preferred vendors...</p>
        ) : vendors.length === 0 ? (
            <p className="empty-state">No preferred vendors available yet.</p>
        ) : (
            <table className="vendors-table">
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Vendor</th>
                        <th>Contact</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Notes</th>
                        <th>Contract</th>
                    </tr>
                </thead>
                <tbody>
                    {vendors.map((vendor) => (
                        <tr key={vendor.id}>
                            <td><span className="category-tag">{vendor.service}</span></td>
                            <td>{vendor.vendor}</td>
                            <td>{vendor.contact || '-'}</td>
                            <td>{formatPhone(vendor.phone) || '-'}</td>
                            <td>
                                {vendor.email ? (
                                    <a href={`mailto:${vendor.email}`} target="_blank" rel="noreferrer">{vendor.email}</a>
                                ) : '-'}
                            </td>
                            <td>{vendor.notes || '-'}</td>
                            <td>
                                {vendor.contract_exists ? (
                                    <a
                                        className="contract-pill"
                                        href={`${API_URL}/files/download?path=${encodeURIComponent(vendor.contract_path || '')}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Contract
                                    </a>
                                ) : (
                                    <span className="contract-pill disabled" aria-disabled="true">Contract</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        )}
    </Card>
);

export default BuildingsVendors;
