# 어머니 돌봄 장부

연세 많으신 어머니의 특이사항과 병원 일정을 가족이 같이 보는 장부입니다.

회사 프로젝트와 따로 두었습니다.

`C:\Users\sunny\Projects\mom-care-ledger`

## 이 컴퓨터에서 기록하기

`start-ledger.bat` 을 더블클릭합니다. 브라우저에 장부가 열리고, 검은 창은 켜 둔 채로 둡니다. 그 창을 닫으면 장부도 멈춥니다.

남긴 기록은 `data\ledger.json` 파일에 저장됩니다.

처음 보이는 홍길순 님 기록은 예시입니다. **예시 지우기**를 누른 뒤 어머니 정보를 적으면 됩니다.

## 형제에게 주소 보내기

1. [GitHub](https://github.com/new)에서 개인 계정으로 새 저장소를 만듭니다. 저장소 이름 예: `mom-care-ledger`
2. 이 폴더에서 아래를 실행합니다. `아이디`와 저장소 이름을 본인 것으로 바꿉니다.

```powershell
cd C:\Users\sunny\Projects\mom-care-ledger
git remote add origin https://github.com/아이디/mom-care-ledger.git
git push -u origin main
```

3. GitHub 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택합니다.
4. Actions가 끝나면 주소는 보통 아래 모양입니다.

`https://아이디.github.io/mom-care-ledger/`

그 주소를 형제에게 보내면 됩니다. 그 주소에서는 보기, 인쇄, 글 복사만 됩니다. 기록은 이 컴퓨터에서 남깁니다.

기록을 고친 뒤 형제 화면에도 보이게 하려면:

```powershell
cd C:\Users\sunny\Projects\mom-care-ledger
git add data/ledger.json
git commit -m "어머니 기록 갱신"
git push
```

## 병원에 가져갈 때

**진료 요약** 탭에서 인쇄하거나, 글을 복사해 카카오톡으로 보낼 수 있습니다. 진료 때 보여 주기에 체크한 특이사항, 알레르기, 복용약, 다음 병원 일정이 들어갑니다.

## 알아둘 점

이 주소는 링크를 아는 사람이 열 수 있습니다. 주민등록번호와 계좌번호는 적지 않습니다. 주소는 동까지만 적어도 충분합니다.

개인 저장소를 만들어도, 무료 GitHub Pages 주소 자체는 링크가 있으면 열리는 경우가 많습니다. 가족끼리만 쓰는 건강 기록으로 두고, 외부에 주소를 올리지 않으면 됩니다.
