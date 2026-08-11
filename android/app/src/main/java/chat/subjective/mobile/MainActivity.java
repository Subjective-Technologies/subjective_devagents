package chat.subjective.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SubjectiveIrcPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }
}
