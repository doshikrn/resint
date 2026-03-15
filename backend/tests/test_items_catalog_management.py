from app.models.item_alias import ItemAlias


def test_admin_can_patch_item_fields(client, auth_headers, seed_zone_warehouse_item):
    item_id = seed_zone_warehouse_item["item"].id

    response = client.patch(
        f"/items/{item_id}",
        headers=auth_headers,
        json={
            "name": "Whole Milk",
            "unit": "литр",
            "step": 0.5,
            "min_qty": 0.5,
            "max_qty": 20,
            "is_favorite": True,
            "is_active": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Whole Milk"
    assert body["unit"] == "l"
    assert body["step"] == 0.5
    assert body["min_qty"] == 0.5
    assert body["max_qty"] == 20
    assert body["is_favorite"] is True


def test_chef_can_manage_aliases(client, auth_headers_chef, seed_zone_warehouse_item):
    item_id = seed_zone_warehouse_item["item"].id

    create_response = client.post(
        f"/items/{item_id}/aliases",
        headers=auth_headers_chef,
        json={"alias_text": "молоко 3.2"},
    )

    assert create_response.status_code == 201
    alias = create_response.json()
    assert alias["item_id"] == item_id
    assert alias["alias_text"] == "молоко 3.2"

    duplicate_response = client.post(
        f"/items/{item_id}/aliases",
        headers=auth_headers_chef,
        json={"alias_text": "  МОЛОКО 3.2  "},
    )
    assert duplicate_response.status_code == 409

    delete_response = client.delete(
        f"/items/{item_id}/aliases/{alias['id']}",
        headers=auth_headers_chef,
    )
    assert delete_response.status_code == 204


def test_souschef_cannot_patch_or_manage_aliases(
    client,
    auth_headers_souschef,
    seed_zone_warehouse_item,
    db_session,
):
    item_id = seed_zone_warehouse_item["item"].id
    alias = ItemAlias(item_id=item_id, alias_text="test-alias")
    db_session.add(alias)
    db_session.commit()
    db_session.refresh(alias)

    patch_response = client.patch(
        f"/items/{item_id}",
        headers=auth_headers_souschef,
        json={"is_favorite": True},
    )
    assert patch_response.status_code == 200

    create_alias_response = client.post(
        f"/items/{item_id}/aliases",
        headers=auth_headers_souschef,
        json={"alias_text": "another"},
    )
    assert create_alias_response.status_code == 201

    delete_alias_response = client.delete(
        f"/items/{item_id}/aliases/{alias.id}",
        headers=auth_headers_souschef,
    )
    assert delete_alias_response.status_code == 204
