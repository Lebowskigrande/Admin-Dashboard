import { useState } from 'react';
import { FaMusic, FaSearch, FaDownload } from 'react-icons/fa';
import Card from '../components/Card';
import './Finance.css'; // Reusing table styles
import './Music.css';

const Music = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [musicFiles, setMusicFiles] = useState([
        { id: 1, title: 'Silent Night', composer: 'Gruber', type: 'Hymn', format: 'PDF', tags: 'Christmas' },
        { id: 2, title: 'Hallelujah Chorus', composer: 'Handel', type: 'Choral', format: 'PDF', tags: 'Easter, Christmas' },
        { id: 3, title: 'Prelude in C', composer: 'Bach', type: 'Organ', format: 'MP3', tags: 'General' },
    ]);

    const filteredMusic = musicFiles.filter(f =>
        f.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.composer.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-music">
            <header className="page-header page-header-bar">
                <div className="page-header-title">
                    <h1>Music Library</h1>
                    <p className="page-header-subtitle is-empty" aria-hidden="true">Spacer</p>
                </div>
                <div className="page-header-actions">
                    <div className="search-bar">
                        <FaSearch className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search library..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </header>

            <Card>
                <table className="finance-table">
                    <thead>
                        <tr>
                            <th>Title</th>
                            <th>Composer</th>
                            <th>Type</th>
                            <th>Format</th>
                            <th>Tags</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredMusic.map(f => (
                            <tr key={f.id}>
                                <td style={{ fontWeight: '500' }}><FaMusic style={{ marginRight: '8px', color: '#666' }} /> {f.title}</td>
                                <td>{f.composer}</td>
                                <td><span className="category-tag">{f.type}</span></td>
                                <td>{f.format}</td>
                                <td>{f.tags}</td>
                                <td>
                                    <button className="btn-icon small text-primary">
                                        <FaDownload />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
        </div>
    );
};

export default Music;
