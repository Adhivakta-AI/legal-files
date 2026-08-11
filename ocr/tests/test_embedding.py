import numpy as np

from judgment_ocr.embedding import _valid_shard


def test_embedding_shard_validation_checks_ids_shape_and_values(tmp_path) -> None:
    path = tmp_path / "part.npz"
    np.savez(
        path,
        ids=np.asarray(["chunk-1", "chunk-2"]),
        vectors=np.ones((2, 384), dtype=np.float32),
    )

    assert _valid_shard(path, ["chunk-1", "chunk-2"], 384)
    assert not _valid_shard(path, ["chunk-2", "chunk-1"], 384)
    assert not _valid_shard(path, ["chunk-1", "chunk-2"], 768)
