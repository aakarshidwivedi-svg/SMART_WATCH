import urllib.parse
from typing import Optional, Dict

class QRService:
    """UPI-spec QR payload builder and parser."""

    @staticmethod
    def build_upi_payload(
        payee_vpa: str,
        payee_name: str,
        amount_paise: Optional[int] = None,
        transaction_note: Optional[str] = None,
        txn_ref: Optional[str] = None
    ) -> str:
        params = {
            "pa": payee_vpa,
            "pn": payee_name,
            "cu": "INR"
        }
        if amount_paise is not None:
            params["am"] = f"{amount_paise / 100:.2f}"
        if transaction_note:
            params["tn"] = transaction_note
        if txn_ref:
            params["tr"] = txn_ref

        query_str = urllib.parse.urlencode(params)
        return f"upi://pay?{query_str}"

    @staticmethod
    def parse_upi_payload(payload: str) -> Dict[str, any]:
        parsed = urllib.parse.urlparse(payload)
        if parsed.scheme != "upi" or parsed.netloc != "pay":
            raise ValueError("Invalid UPI QR format")

        params = urllib.parse.parse_qs(parsed.query)
        vpa = params.get("pa", [None])[0]
        name = params.get("pn", [vpa or "Unknown Merchant"])[0]
        am_str = params.get("am", [None])[0]
        note = params.get("tn", [None])[0]
        tr = params.get("tr", [None])[0]

        amount_paise = None
        if am_str:
            try:
                # Convert rupee float string to integer paise safely
                amount_paise = int(round(float(am_str) * 100))
            except ValueError:
                pass

        return {
            "payee_vpa": vpa,
            "payee_name": name,
            "amount_paise": amount_paise,
            "note": note,
            "txn_ref": tr
        }
